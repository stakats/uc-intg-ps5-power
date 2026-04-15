/**
 * PlayStation Power Integration Driver for Unfolded Circle Remote
 *
 * Exposes a Switch entity that wakes and puts a PlayStation (PS4/PS5)
 * into standby using the playactor library. Includes a guided setup
 * flow for PSN OAuth login and device registration, with backup/restore
 * support compatible with Integration Manager.
 *
 * Requirements:
 *   - PS4 or PS5 on the same network, powered on for initial setup
 *   - Node.js v22+ (on-device)
 */

import * as uc from "@unfoldedcircle/integration-api";
import { Device } from "playactor/dist/device.js";
import { DeviceStatus } from "playactor/dist/discovery/model.js";
import { extractAccountId, registKeyToCredential } from "playactor/dist/credentials/oauth/requester.js";
import { RemotePlayRegistration } from "playactor/dist/remoteplay/registration.js";
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

// Sony PSN OAuth constants (from playactor, not exported)
const CLIENT_ID = "ba495a24-818c-472b-b12d-ff231c1b5745";
const CLIENT_SECRET = "mvaiZkRsAsI1IBkY";
const REDIRECT_URI = "https://remoteplay.dl.playstation.net/remoteplay/redirect";
const LOGIN_URL = `https://auth.api.sonyentertainmentnetwork.com/2.0/oauth/authorize?service_entity=urn:service-entity:psn&response_type=code&client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=psn:clientapp&request_locale=en_US&ui=pr&service_logo=ps&layout_type=popup&smcid=remoteplay&prompt=always&PlatformPrivacyWs1=minimal&`;
const TOKEN_URL = "https://auth.api.sonyentertainmentnetwork.com/2.0/oauth/token";

const driver = new uc.IntegrationAPI();

// ---------------------------------------------------------------------------
// Credential storage
// ---------------------------------------------------------------------------

function getPlayactorCredentialsDir(): string {
  return path.join(driver.getConfigDirPath(), ".config", "playactor");
}

function getCredentialsPath(): string {
  return path.join(getPlayactorCredentialsDir(), "credentials.json");
}

function configurePlayactorHome(): void {
  process.env.HOME = driver.getConfigDirPath();
}

function hasCredentials(): boolean {
  return fs.existsSync(getCredentialsPath());
}

function readCredentialsJson(): string | null {
  try {
    const content = fs.readFileSync(getCredentialsPath(), "utf-8");
    JSON.parse(content); // validate
    return content;
  } catch {
    return null;
  }
}

function restoreCredentialsJson(json: string): boolean {
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      console.error("[ps5] Restore failed: expected JSON object");
      return false;
    }
    if (Object.keys(parsed).length === 0) {
      console.error("[ps5] Restore failed: empty credentials");
      return false;
    }
    const credDir = getPlayactorCredentialsDir();
    fs.mkdirSync(credDir, { recursive: true });
    fs.writeFileSync(getCredentialsPath(), JSON.stringify(parsed, null, 2), "utf-8");
    configurePlayactorHome();
    console.log("[ps5] Credentials restored");
    return true;
  } catch (err) {
    console.error("[ps5] Restore failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

function deleteCredentials(): void {
  try {
    if (fs.existsSync(getCredentialsPath())) {
      fs.unlinkSync(getCredentialsPath());
      console.log("[ps5] Credentials deleted");
    }
  } catch (err) {
    console.error("[ps5] Delete failed:", err instanceof Error ? err.message : err);
  }
}

function writeCredentials(deviceId: string, credentials: Record<string, unknown>): void {
  const credDir = getPlayactorCredentialsDir();
  fs.mkdirSync(credDir, { recursive: true });

  let existing: Record<string, unknown> = {};
  const credPath = getCredentialsPath();
  if (fs.existsSync(credPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(credPath, "utf-8"));
    } catch {
      // corrupted file, start fresh
    }
  }
  existing[deviceId] = credentials;
  fs.writeFileSync(credPath, JSON.stringify(existing, null, 2), "utf-8");
  console.log(`[ps5] Credentials saved for device ${deviceId}`);
}

// ---------------------------------------------------------------------------
// OAuth helpers (using Node 22 built-in fetch)
// ---------------------------------------------------------------------------

function basicAuthHeader(): string {
  return "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
}

async function exchangeCodeForToken(code: string): Promise<string> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI
    })
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`);
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("No access_token in response");
  }
  return data.access_token;
}

async function fetchAccountId(accessToken: string): Promise<string> {
  const response = await fetch(`${TOKEN_URL}/${accessToken}`, {
    headers: { Authorization: basicAuthHeader() }
  });

  if (!response.ok) {
    throw new Error(`Account info fetch failed: ${response.status}`);
  }

  const accountInfo = (await response.json()) as { user_id?: string };
  if (!accountInfo.user_id) {
    throw new Error("No user_id in account info");
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return extractAccountId(accountInfo as any);
}

// ---------------------------------------------------------------------------
// Setup flow — multi-step state machine with backup/restore
//
// Field IDs follow ucapi-framework conventions for Integration Manager
// compatibility: choice, restore_from_backup, backup_data, restore_data
// ---------------------------------------------------------------------------

// State persisted across setup handler invocations
type SetupMode = "idle" | "configure" | "restore";
let setupMode: SetupMode = "idle";
let setupOAuthStep = 0; // 0=not started, 3=waiting for redirect URL, 5=waiting for PIN
let setupAccountId: string | null = null;

const REDIRECT_URL_FIELD = "redirect_url";
const PIN_FIELD = "pin";

function resetSetupState(): void {
  setupMode = "idle";
  setupOAuthStep = 0;
  setupAccountId = null;
}

// --- Initial setup screen (fresh install) ---

function showInitialSetupScreen(): uc.SetupAction {
  return new uc.RequestUserInput({ en: "PlayStation Power Setup" }, [
    {
      id: "restore_from_backup",
      label: { en: "Setup mode" },
      field: {
        dropdown: {
          value: "false",
          items: [
            { id: "false", label: { en: "Set up new device" } },
            { id: "true", label: { en: "Restore from backup" } }
          ]
        }
      }
    }
  ]);
}

// --- Reconfigure screen (existing install) ---

function showReconfigureScreen(): uc.SetupAction {
  return new uc.RequestUserInput({ en: "PlayStation Power" }, [
    {
      id: "choice",
      label: { en: "Action" },
      field: {
        dropdown: {
          value: "configure",
          items: [
            { id: "configure", label: { en: "Re-pair device" } },
            { id: "backup", label: { en: "Create configuration backup" } },
            {
              id: "restore",
              label: { en: "Restore configuration from backup" }
            },
            { id: "delete_config", label: { en: "Delete configuration" } }
          ]
        }
      }
    }
  ]);
}

// --- Backup screen ---

function showBackupScreen(): uc.SetupAction {
  const json = readCredentialsJson() ?? "{}";
  return new uc.RequestUserInput({ en: "Configuration Backup" }, [
    {
      id: "info",
      label: { en: "Backup" },
      field: {
        label: {
          value: {
            en: "Copy the data below and save it in a safe place. You can use this to restore your configuration after an integration update."
          }
        }
      }
    },
    {
      id: "backup_data",
      label: { en: "Backup data" },
      field: { textarea: { value: json } }
    }
  ]);
}

// --- Restore screen ---

function showRestoreScreen(): uc.SetupAction {
  return new uc.RequestUserInput({ en: "Restore Configuration" }, [
    {
      id: "restore_data",
      label: { en: "Paste the configuration backup data below" },
      field: { textarea: { value: "" } }
    }
  ]);
}

// --- OAuth + PIN configure flow screens ---

function showRedirectUrlInput(): uc.SetupAction {
  return new uc.RequestUserInput({ en: "Sign in to PlayStation Network" }, [
    {
      id: "info_login",
      label: { en: "Step 1: Sign in" },
      field: {
        label: {
          value: {
            en:
              'Open the following URL in a browser on your phone or computer and sign in to your PlayStation Network account. After signing in, you will see a page that just says "redirect" — this is expected.\n\n' +
              LOGIN_URL
          }
        }
      }
    },
    {
      id: "info_copy",
      label: { en: "Step 2: Copy the redirect URL" },
      field: {
        label: {
          value: {
            en: "After signing in, your browser's address bar will show a URL that looks like:\n\nremoteplay.dl.playstation.net/remoteplay/redirect?code=XXXXX...\n\nCopy the full URL from the address bar and paste it below."
          }
        }
      }
    },
    {
      id: REDIRECT_URL_FIELD,
      label: { en: "Redirect URL" },
      field: { textarea: { value: "" } }
    }
  ]);
}

function showPINInput(): uc.SetupAction {
  return new uc.RequestUserInput({ en: "Pair with your PlayStation" }, [
    {
      id: "info_pair",
      label: { en: "Open the pairing screen" },
      field: {
        label: {
          value: {
            en: "On your PlayStation, navigate to the Remote Play pairing screen:\n\nPS5: Settings > System > Remote Play > Pair Device\n\nPS4: Settings > Remote Play Connection Settings > Add Device\n\nAn 8-digit PIN will appear on your TV. Make sure your PlayStation is powered on (not in rest mode) and on the same network as your remote."
          }
        }
      }
    },
    {
      id: PIN_FIELD,
      label: { en: "8-digit PIN from your TV" },
      field: { text: { value: "" } }
    }
  ]);
}

// --- Main setup handler ---

async function setupHandler(msg: uc.SetupDriver): Promise<uc.SetupAction> {
  if (msg instanceof uc.DriverSetupRequest) {
    console.log(`[ps5] Setup started (reconfigure: ${msg.reconfigure})`);
    resetSetupState();

    if (msg.reconfigure) {
      // Reconfigure: check for Integration Manager driven actions in setupData
      const setupData = msg.setupData ?? {};
      const action = String(setupData.action ?? setupData.choice ?? "").toLowerCase();

      if (action === "backup") {
        const provided = typeof setupData.backup_data === "string" ? setupData.backup_data.trim() : "";
        if (!provided || provided === "[]") {
          return showBackupScreen();
        }
        // Integration Manager sent backup_data back — treat as complete
        return new uc.SetupComplete();
      }

      if (action === "restore") {
        const restoreData =
          (typeof setupData.restore_data === "string" && setupData.restore_data.trim()
            ? setupData.restore_data
            : null) ??
          (typeof setupData.backup_data === "string" && setupData.backup_data.trim() ? setupData.backup_data : null);

        if (restoreData) {
          if (restoreCredentialsJson(restoreData)) {
            return new uc.SetupComplete();
          }
          return new uc.SetupError(uc.IntegrationSetupError.Other);
        }
        setupMode = "restore";
        return showRestoreScreen();
      }

      if (action === "configure") {
        setupMode = "configure";
        setupOAuthStep = 3;
        return showRedirectUrlInput();
      }

      // No action yet — show the reconfigure menu
      return showReconfigureScreen();
    }

    // Fresh setup: check for restore_from_backup from Integration Manager
    const setupData = msg.setupData ?? {};
    const restoreMode = String(setupData.restore_from_backup ?? "").toLowerCase() === "true";

    if (restoreMode) {
      const restoreData =
        (typeof setupData.restore_data === "string" && setupData.restore_data.trim() ? setupData.restore_data : null) ??
        (typeof setupData.backup_data === "string" && setupData.backup_data.trim() ? setupData.backup_data : null);

      if (restoreData) {
        if (restoreCredentialsJson(restoreData)) {
          return new uc.SetupComplete();
        }
        return new uc.SetupError(uc.IntegrationSetupError.Other);
      }
      setupMode = "restore";
      return showRestoreScreen();
    }

    // Show initial setup screen
    return showInitialSetupScreen();
  }

  if (msg instanceof uc.UserDataResponse) {
    const input = msg.inputValues;

    // --- OAuth Step 3: Redirect URL submitted (CHECK FIRST so stale fields can't hijack) ---
    if (setupOAuthStep === 3 && input[REDIRECT_URL_FIELD] !== undefined) {
      const redirectUrl = input[REDIRECT_URL_FIELD];
      if (!redirectUrl) {
        console.error("[ps5] Empty redirect URL");
        return new uc.SetupError(uc.IntegrationSetupError.Other);
      }

      try {
        const url = new URL(redirectUrl);
        const code = url.searchParams.get("code");
        if (!code) {
          console.error("[ps5] No 'code' parameter in redirect URL");
          return new uc.SetupError(uc.IntegrationSetupError.AuthorizationError);
        }

        console.log("[ps5] Exchanging OAuth code for token...");
        const accessToken = await exchangeCodeForToken(code);

        console.log("[ps5] Fetching account info...");
        setupAccountId = await fetchAccountId(accessToken);
        console.log("[ps5] Got accountId");
      } catch (err) {
        console.error("[ps5] OAuth failed:", err instanceof Error ? err.message : err);
        return new uc.SetupError(uc.IntegrationSetupError.AuthorizationError);
      }

      setupOAuthStep = 5;
      return showPINInput();
    }

    // --- OAuth Step 5: PIN submitted ---
    if (setupOAuthStep === 5 && input[PIN_FIELD] !== undefined) {
      const pin = input[PIN_FIELD];
      if (!pin || !/^\d{8}$/.test(pin.trim())) {
        console.error("[ps5] Invalid PIN (must be 8 digits)");
        return new uc.SetupError(uc.IntegrationSetupError.Other);
      }

      try {
        console.log("[ps5] Discovering PlayStation on network...");
        const discovered = await Device.any().discover();
        console.log(`[ps5] Found ${discovered.name} (${discovered.id}) — ${discovered.status}`);

        if (discovered.status !== DeviceStatus.AWAKE) {
          console.error("[ps5] PlayStation must be powered on for registration");
          return new uc.SetupError(uc.IntegrationSetupError.ConnectionRefused);
        }

        console.log("[ps5] Registering with PlayStation...");
        const registration = new RemotePlayRegistration();
        const regResult = await registration.register(discovered, {
          accountId: setupAccountId!,
          pin: pin.trim()
        });

        const registKey = regResult["PS5-RegistKey"] ?? regResult["PS4-RegistKey"];
        if (!registKey) {
          throw new Error("No RegistKey in registration response");
        }

        const credentials = {
          "app-type": "r",
          "auth-type": "R",
          "client-type": "vr",
          model: "w",
          "user-credential": registKeyToCredential(registKey),
          accountId: setupAccountId,
          registration: regResult
        };

        writeCredentials(discovered.id, credentials);
        configurePlayactorHome();
        resetSetupState();

        // Check actual PS5 state so the entity reflects reality immediately,
        // without waiting for the next Connect event.
        const state = await checkPS5State();
        if (state === "ON") updateState(uc.SwitchStates.On);
        else if (state === "OFF") updateState(uc.SwitchStates.Off);
        else updateState(uc.SwitchStates.Unknown);

        console.log("[ps5] Registration complete");
        return new uc.SetupComplete();
      } catch (err) {
        console.error("[ps5] Registration failed:", err instanceof Error ? err.message : err);
        resetSetupState();
        return new uc.SetupError(uc.IntegrationSetupError.Other);
      }
    }

    // --- Restore flow (from initial setup or reconfigure) ---
    if (setupMode === "restore" || input.restore_data !== undefined) {
      const data = input.restore_data ?? input.backup_data;
      if (!data || !data.trim()) {
        console.error("[ps5] Empty restore data");
        return new uc.SetupError(uc.IntegrationSetupError.Other);
      }
      if (restoreCredentialsJson(data)) {
        resetSetupState();
        // Connect event will run checkPS5State and update entity state.
        return new uc.SetupComplete();
      }
      return new uc.SetupError(uc.IntegrationSetupError.Other);
    }

    // --- Reconfigure action dropdown (check before backup_data, since backup screens echo back the data) ---
    const action = String(input.action ?? input.choice ?? "").toLowerCase();

    if (action === "backup") {
      // Integration Manager sends "[]" as a placeholder requesting the backup textarea.
      // If the user just submitted the backup screen (echoing the data we showed them), treat as complete.
      const provided = typeof input.backup_data === "string" ? input.backup_data.trim() : "";
      if (provided && provided !== "[]") {
        resetSetupState();
        return new uc.SetupComplete();
      }
      return showBackupScreen();
    }
    if (action === "restore") {
      setupMode = "restore";
      return showRestoreScreen();
    }
    if (action === "delete_config") {
      deleteCredentials();
      resetSetupState();
      return new uc.SetupComplete();
    }
    if (action === "configure") {
      setupMode = "configure";
      setupOAuthStep = 3;
      return showRedirectUrlInput();
    }

    // --- Backup screen submitted without action (user copied data, just complete) ---
    if (input.backup_data !== undefined) {
      resetSetupState();
      return new uc.SetupComplete();
    }

    // --- Initial setup: route by restore_from_backup dropdown (LAST, so stale values don't hijack) ---
    if (input.restore_from_backup !== undefined) {
      const restoreMode = String(input.restore_from_backup).toLowerCase() === "true";
      if (restoreMode) {
        setupMode = "restore";
        return showRestoreScreen();
      }
      // User chose "Set up new device" — start OAuth flow
      setupMode = "configure";
      setupOAuthStep = 3;
      return showRedirectUrlInput();
    }

    return new uc.SetupError();
  }

  if (msg instanceof uc.AbortDriverSetup) {
    console.log("[ps5] Setup aborted");
    resetSetupState();
  }

  return new uc.SetupError();
}

// ---------------------------------------------------------------------------
// Integration init
// ---------------------------------------------------------------------------

driver.init(path.join(__dirname, "driver.json"), setupHandler);

const credentialsExist = hasCredentials();
console.log(`[ps5] Config dir: ${driver.getConfigDirPath()}`);
console.log(`[ps5] Credentials exist: ${credentialsExist}`);
if (credentialsExist) {
  configurePlayactorHome();
}

// ---------------------------------------------------------------------------
// PlayStation state checking via playactor discover (UDP, does not wake device)
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkPS5State(): Promise<"ON" | "OFF" | null> {
  try {
    console.log("[ps5] Checking PS5 state...");
    const discovered = await Device.any().discover();
    console.log(`[ps5] PS5 state: ${discovered.status}`);
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

let commandInProgress = false;

const cmdHandler: uc.CommandHandler = async function (entity: uc.Entity, cmdId: string): Promise<uc.StatusCodes> {
  console.log(`[ps5] Command received: ${cmdId}`);

  if (!hasCredentials()) {
    console.error("[ps5] No credentials configured");
    return uc.StatusCodes.ServiceUnavailable;
  }

  if (commandInProgress) {
    console.log("[ps5] Command already in progress, ignoring");
    return uc.StatusCodes.Ok;
  }

  // Resolve toggle to on/off based on current entity state
  let resolved = cmdId;
  if (cmdId === "toggle") {
    const currentState = entity.attributes?.[uc.SwitchAttributes.State];
    resolved = currentState === uc.SwitchStates.On ? "off" : "on";
    console.log(`[ps5] Toggle resolved to: ${resolved}`);
  }

  // Fire-and-forget: return Ok immediately so we don't hit the remote's
  // ~10s command timeout. playactor discovery + wake can take longer.
  switch (resolved) {
    case "on":
      commandInProgress = true;
      wakePS5()
        .catch((err) => {
          console.error("[ps5] Wake failed:", err instanceof Error ? err.message : err);
        })
        .finally(() => {
          commandInProgress = false;
        });
      return uc.StatusCodes.Ok;

    case "off":
      commandInProgress = true;
      standbyPS5()
        .catch((err) => {
          console.error("[ps5] Standby failed:", err instanceof Error ? err.message : err);
        })
        .finally(() => {
          commandInProgress = false;
        });
      return uc.StatusCodes.Ok;

    default:
      console.error(`[ps5] Unknown command: ${cmdId}`);
      return uc.StatusCodes.NotImplemented;
  }
};

// ---------------------------------------------------------------------------
// Entity
// ---------------------------------------------------------------------------

const ps5Switch = new uc.Switch(ENTITY_ID, "PlayStation", {
  features: [uc.SwitchFeatures.OnOff, uc.SwitchFeatures.Toggle],
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

  const state = await checkPS5State();
  if (state === "ON") updateState(uc.SwitchStates.On);
  else if (state === "OFF") updateState(uc.SwitchStates.Off);
  else updateState(uc.SwitchStates.Unknown);
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

console.log("[ps5] PlayStation Power integration driver started");
