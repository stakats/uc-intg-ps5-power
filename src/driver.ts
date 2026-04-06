/**
 * PS5 Power Integration Driver for Unfolded Circle Remote
 *
 * Exposes a Switch entity that wakes and puts the PS5 into standby
 * using the `playactor` CLI tool.
 *
 * Requirements:
 *   - playactor installed and logged in (run `npx playactor login` once)
 *   - Node.js v20+
 */

import * as uc from "@unfoldedcircle/integration-api";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execAsync = promisify(exec);

// Node.js 20.11 / 21.2
const __dirname = import.meta.dirname;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Resolve playactor binary from node_modules so it works reliably on-device
const PLAYACTOR_BIN = path.join(__dirname, "..", "node_modules", ".bin", "playactor");

const ENTITY_ID = "ps5_power";

const driver = new uc.IntegrationAPI();

/**
 * Return the directory where playactor expects to find its credentials.
 * On-device this is under the integration's config home; locally it falls back to ~/.config.
 */
function getPlayactorCredentialsDir(): string {
  const configDir = driver.getConfigDirPath();
  return path.join(configDir, ".config", "playactor");
}

/**
 * Point HOME at the integration's config directory so playactor resolves
 * its credentials at $HOME/.config/playactor/credentials.json.
 */
function configurePlayactorHome(): void {
  const configDir = driver.getConfigDirPath();
  process.env.HOME = configDir;
  console.log("[ps5] HOME set to:", configDir);
}

/**
 * Check if playactor credentials exist on disk.
 */
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
  console.log("[ps5] Credentials saved to:", credDir);

  configurePlayactorHome();
  return new uc.SetupComplete();
}

async function setupHandler(msg: uc.SetupDriver): Promise<uc.SetupAction> {
  if (msg instanceof uc.DriverSetupRequest) {
    console.log("[ps5] Setup requested, reconfigure:", msg.reconfigure);
    // The remote presents the setup_data_schema form first, then sends the
    // user's input in setupData. Try to save credentials from it.
    return saveCredentials(msg.setupData);
  }

  if (msg instanceof uc.UserDataResponse) {
    console.log("[ps5] Received user data response");
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

// If credentials already exist (from a previous setup), configure HOME immediately
if (hasCredentials()) {
  configurePlayactorHome();
}

// ---------------------------------------------------------------------------
// playactor helpers
// ---------------------------------------------------------------------------

async function wakePS5(): Promise<void> {
  console.log("[ps5] Sending wake command...");
  const { stdout, stderr } = await execAsync(`${PLAYACTOR_BIN} wake`, { timeout: 30000 });
  if (stdout) console.log("[ps5] wake stdout:", stdout.trim());
  if (stderr) console.warn("[ps5] wake stderr:", stderr.trim());
}

async function standbyPS5(): Promise<void> {
  console.log("[ps5] Sending standby command...");
  const { stdout, stderr } = await execAsync(`${PLAYACTOR_BIN} standby`, { timeout: 30000 });
  if (stdout) console.log("[ps5] standby stdout:", stdout.trim());
  if (stderr) console.warn("[ps5] standby stderr:", stderr.trim());
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

const cmdHandler: uc.CommandHandler = async function (
  entity: uc.Entity,
  cmdId: string,
  _params?: { [key: string]: string | number | boolean }
): Promise<uc.StatusCodes> {
  console.log(`[ps5] Command received: ${cmdId} for entity: ${entity.id}`);

  if (!hasCredentials()) {
    console.error("[ps5] No playactor credentials configured. Run setup first.");
    return uc.StatusCodes.ServiceUnavailable;
  }

  try {
    switch (cmdId) {
      case "on":
        await wakePS5();
        driver.updateEntityAttributes(ENTITY_ID, {
          [uc.SwitchAttributes.State]: uc.SwitchStates.On
        });
        break;

      case "off":
        await standbyPS5();
        driver.updateEntityAttributes(ENTITY_ID, {
          [uc.SwitchAttributes.State]: uc.SwitchStates.Off
        });
        break;

      default:
        console.warn(`[ps5] Unknown command: ${cmdId}`);
        return uc.StatusCodes.NotImplemented;
    }

    return uc.StatusCodes.Ok;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ps5] Command failed: ${message}`);
    return uc.StatusCodes.ServerError;
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
  console.log("[ps5] Remote connected");
  await driver.setDeviceState(uc.DeviceStates.Connected);
});

driver.on(uc.Events.Disconnect, async () => {
  console.log("[ps5] Remote disconnected");
  await driver.setDeviceState(uc.DeviceStates.Disconnected);
});

driver.on(uc.Events.EnterStandby, () => {
  console.log("[ps5] Remote entering standby");
});

driver.on(uc.Events.ExitStandby, () => {
  console.log("[ps5] Remote exiting standby");
});

driver.on(uc.Events.SubscribeEntities, async (entityIds: string[]) => {
  entityIds.forEach((entityId: string) => {
    console.log(`[ps5] Subscribed entity: ${entityId}`);
  });
});

driver.on(uc.Events.UnsubscribeEntities, async (entityIds: string[]) => {
  entityIds.forEach((entityId: string) => {
    console.log(`[ps5] Unsubscribed entity: ${entityId}`);
  });
});

console.log("[ps5] PS5 Power integration driver started");
