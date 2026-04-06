/**
 * PS5 Power Integration Driver for Unfolded Circle Remote
 *
 * Exposes a Switch entity that wakes and puts the PS5 into standby
 * using the playactor library (programmatic API, no shell required).
 * Reports actual PS5 power state via UDP discovery for activity
 * readiness checks.
 *
 * Requirements:
 *   - playactor credentials (paste during integration setup)
 *   - Node.js v22+
 */

import * as uc from "@unfoldedcircle/integration-api";
import { Device } from "playactor/dist/device.js";
import { DeviceStatus } from "playactor/dist/discovery/model.js";
import fs from "fs";
import path from "path";

const __dirname = import.meta.dirname;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ENTITY_ID = "ps5_power";
const WAKE_CHECK_DELAY_MS = 5000;
const STANDBY_CHECK_DELAY_MS = 15000;
const MAX_WAKE_RETRIES = 2;

const driver = new uc.IntegrationAPI();

function getPlayactorCredentialsDir(): string {
  const configDir = driver.getConfigDirPath();
  return path.join(configDir, ".config", "playactor");
}

/**
 * Point HOME at the integration's config directory so playactor resolves
 * its credentials at $HOME/.config/playactor/credentials.json.
 */
function configurePlayactorHome(): void {
  process.env.HOME = driver.getConfigDirPath();
}

function hasCredentials(): boolean {
  return fs.existsSync(path.join(getPlayactorCredentialsDir(), "credentials.json"));
}

// ---------------------------------------------------------------------------
// Setup flow
// ---------------------------------------------------------------------------

const CREDENTIALS_FIELD_ID = "playactor_credentials";

function saveCredentials(data: { [key: string]: string }): uc.SetupAction {
  const raw = data[CREDENTIALS_FIELD_ID];

  if (!raw || !raw.trim()) {
    console.error("[ps5] Empty credentials");
    return new uc.SetupError(uc.IntegrationSetupError.Other);
  }

  try {
    JSON.parse(raw);
  } catch {
    console.error("[ps5] Invalid JSON in credentials");
    return new uc.SetupError(uc.IntegrationSetupError.Other);
  }

  const credDir = getPlayactorCredentialsDir();
  fs.mkdirSync(credDir, { recursive: true });
  fs.writeFileSync(path.join(credDir, "credentials.json"), raw, "utf-8");
  console.log("[ps5] Credentials saved");

  configurePlayactorHome();
  return new uc.SetupComplete();
}

async function setupHandler(msg: uc.SetupDriver): Promise<uc.SetupAction> {
  if (msg instanceof uc.DriverSetupRequest) {
    return saveCredentials(msg.setupData);
  }

  if (msg instanceof uc.UserDataResponse) {
    return saveCredentials(msg.inputValues);
  }

  if (msg instanceof uc.AbortDriverSetup) {
    console.log("[ps5] Setup aborted");
  }

  return new uc.SetupError();
}

// ---------------------------------------------------------------------------
// Integration init
// ---------------------------------------------------------------------------

driver.init(path.join(__dirname, "driver.json"), setupHandler);

if (hasCredentials()) {
  configurePlayactorHome();
}

// ---------------------------------------------------------------------------
// PS5 state checking via playactor discover (UDP, does not wake device)
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkPS5State(): Promise<"ON" | "OFF" | null> {
  try {
    const discovered = await Device.any().discover();
    if (discovered.status === DeviceStatus.AWAKE) return "ON";
    if (discovered.status === DeviceStatus.STANDBY) return "OFF";
    return null;
  } catch {
    return null;
  }
}

function updateState(state: uc.SwitchStates): void {
  driver.updateEntityAttributes(ENTITY_ID, {
    [uc.SwitchAttributes.State]: state
  });
}

// ---------------------------------------------------------------------------
// playactor commands with state verification
// ---------------------------------------------------------------------------

async function wakePS5(): Promise<void> {
  for (let attempt = 1; attempt <= MAX_WAKE_RETRIES + 1; attempt++) {
    console.log(`[ps5] Sending wake (attempt ${attempt})...`);
    await Device.any().wake();
    await delay(WAKE_CHECK_DELAY_MS);

    const state = await checkPS5State();
    if (state === "ON") {
      console.log("[ps5] Wake confirmed — PS5 is AWAKE");
      updateState(uc.SwitchStates.On);
      return;
    }
    console.log(
      `[ps5] Wake not confirmed (state: ${state}), ${attempt <= MAX_WAKE_RETRIES ? "retrying..." : "giving up"}`
    );
  }
  console.error("[ps5] Wake failed after retries");
  const finalState = await checkPS5State();
  updateState(finalState === "ON" ? uc.SwitchStates.On : uc.SwitchStates.Off);
}

async function standbyPS5(): Promise<void> {
  console.log("[ps5] Sending standby...");
  const connection = await Device.any().openConnection();
  try {
    await connection.standby();
  } finally {
    await connection.close();
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    await delay(STANDBY_CHECK_DELAY_MS);
    const state = await checkPS5State();
    if (state === "OFF") {
      console.log("[ps5] Standby confirmed — PS5 is in STANDBY");
      updateState(uc.SwitchStates.Off);
      return;
    }
    console.log(`[ps5] Standby not confirmed (state: ${state}), ${attempt < 2 ? "rechecking..." : "giving up"}`);
  }
  console.error("[ps5] Standby not confirmed after rechecks");
  const finalState = await checkPS5State();
  updateState(finalState === "ON" ? uc.SwitchStates.On : uc.SwitchStates.Off);
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

const cmdHandler: uc.CommandHandler = async function (_entity: uc.Entity, cmdId: string): Promise<uc.StatusCodes> {
  if (!hasCredentials()) {
    console.error("[ps5] No credentials configured");
    return uc.StatusCodes.ServiceUnavailable;
  }

  // Fire-and-forget: return Ok immediately so we don't hit the remote's
  // ~10s command timeout. playactor discovery + wake can take longer.
  switch (cmdId) {
    case "on":
      wakePS5().catch((err) => {
        console.error("[ps5] Wake failed:", err instanceof Error ? err.message : err);
      });
      return uc.StatusCodes.Ok;

    case "off":
      standbyPS5().catch((err) => {
        console.error("[ps5] Standby failed:", err instanceof Error ? err.message : err);
      });
      return uc.StatusCodes.Ok;

    default:
      return uc.StatusCodes.NotImplemented;
  }
};

// ---------------------------------------------------------------------------
// Entity
// ---------------------------------------------------------------------------

const ps5Switch = new uc.Switch(ENTITY_ID, "PS5", {
  features: [uc.SwitchFeatures.OnOff],
  attributes: {
    [uc.SwitchAttributes.State]: uc.SwitchStates.Off
  }
});
ps5Switch.setCmdHandler(cmdHandler);
driver.addAvailableEntity(ps5Switch);

// ---------------------------------------------------------------------------
// Driver lifecycle events
// ---------------------------------------------------------------------------

driver.on(uc.Events.Connect, async () => {
  await driver.setDeviceState(uc.DeviceStates.Connected);

  // Report actual PS5 state on connect
  const state = await checkPS5State();
  if (state === "ON") updateState(uc.SwitchStates.On);
  else if (state === "OFF") updateState(uc.SwitchStates.Off);
});

driver.on(uc.Events.Disconnect, async () => {
  await driver.setDeviceState(uc.DeviceStates.Disconnected);
});

driver.on(uc.Events.SubscribeEntities, async (entityIds: string[]) => {
  entityIds.forEach((id) => console.log(`[ps5] Subscribed: ${id}`));
});

driver.on(uc.Events.UnsubscribeEntities, async (entityIds: string[]) => {
  entityIds.forEach((id) => console.log(`[ps5] Unsubscribed: ${id}`));
});

console.log("[ps5] PS5 Power integration driver started");
