/**
 * PS5 Power Integration Driver for Unfolded Circle Remote
 *
 * Exposes a Switch entity that wakes and puts the PS5 into standby
 * using the playactor library (programmatic API, no shell required).
 *
 * Requirements:
 *   - playactor credentials (paste during integration setup)
 *   - Node.js v22+
 */

import * as uc from "@unfoldedcircle/integration-api";
import { Device } from "playactor/dist/device.js";
import fs from "fs";
import path from "path";

const __dirname = import.meta.dirname;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ENTITY_ID = "ps5_power";

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
// playactor helpers (programmatic API — no shell needed)
// ---------------------------------------------------------------------------

async function wakePS5(): Promise<void> {
  console.log("[ps5] Sending wake...");
  await Device.any().wake();
  console.log("[ps5] Wake completed");
}

async function standbyPS5(): Promise<void> {
  console.log("[ps5] Sending standby...");
  const connection = await Device.any().openConnection();
  try {
    await connection.standby();
    console.log("[ps5] Standby completed");
  } finally {
    await connection.close();
  }
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

const cmdHandler: uc.CommandHandler = async function (
  entity: uc.Entity,
  cmdId: string,
  _params?: { [key: string]: string | number | boolean }
): Promise<uc.StatusCodes> {
  if (!hasCredentials()) {
    console.error("[ps5] No credentials configured");
    return uc.StatusCodes.ServiceUnavailable;
  }

  // Fire-and-forget: return Ok immediately so we don't hit the remote's
  // ~10s command timeout. playactor discovery + wake can take longer than that.
  switch (cmdId) {
    case "on":
      wakePS5()
        .then(() => {
          driver.updateEntityAttributes(ENTITY_ID, {
            [uc.SwitchAttributes.State]: uc.SwitchStates.On
          });
        })
        .catch((err) => {
          console.error("[ps5] Wake failed:", err instanceof Error ? err.message : err);
        });
      return uc.StatusCodes.Ok;

    case "off":
      standbyPS5()
        .then(() => {
          driver.updateEntityAttributes(ENTITY_ID, {
            [uc.SwitchAttributes.State]: uc.SwitchStates.Off
          });
        })
        .catch((err) => {
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
    [uc.SwitchAttributes.State]: uc.SwitchStates.Unknown
  },
  options: {
    [uc.SwitchOptions.Readable]: false
  }
});
ps5Switch.setCmdHandler(cmdHandler);
driver.addAvailableEntity(ps5Switch);

// ---------------------------------------------------------------------------
// Driver lifecycle events
// ---------------------------------------------------------------------------

driver.on(uc.Events.Connect, async () => {
  await driver.setDeviceState(uc.DeviceStates.Connected);
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
