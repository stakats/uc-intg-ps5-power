/**
 * PS5 Power Integration Driver for Unfolded Circle Remote
 *
 * Exposes a Switch entity that wakes and puts the PS5 into standby
 * using the playactor library. Includes a guided setup flow for
 * PSN OAuth login and PS5 device registration.
 *
 * Requirements:
 *   - PS5 on the same network, powered on for initial setup
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

function writeCredentials(deviceId: string, credentials: Record<string, unknown>): void {
  const credDir = getPlayactorCredentialsDir();
  fs.mkdirSync(credDir, { recursive: true });

  // Merge with existing credentials file (may have multiple devices)
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
// Setup flow — multi-step state machine
// ---------------------------------------------------------------------------

// State persisted across setup handler invocations
let setupStep = 0;
let setupAccountId: string | null = null;

const REDIRECT_URL_FIELD = "redirect_url";
const PIN_FIELD = "pin";

async function setupHandler(msg: uc.SetupDriver): Promise<uc.SetupAction> {
  // Step 1: Initial request — show PSN login URL
  if (msg instanceof uc.DriverSetupRequest) {
    console.log("[ps5] Setup started");
    setupStep = 1;
    setupAccountId = null;

    return new uc.RequestUserConfirmation(
      { en: "Step 1: Sign in to PlayStation Network" },
      {
        en:
          'Open the following URL in a browser on your phone or computer and sign in to your PlayStation Network account. After signing in, you will see a page that just says "redirect" — this is expected.\n\n' +
          LOGIN_URL
      }
    );
  }

  if (msg instanceof uc.UserConfirmationResponse) {
    if (!msg.confirm) {
      console.log("[ps5] Setup cancelled by user");
      return new uc.SetupError();
    }

    if (setupStep === 1) {
      // After PSN login confirmation — show redirect URL instructions
      setupStep = 2;
      return new uc.RequestUserConfirmation(
        { en: "Step 2: Copy the redirect URL" },
        {
          en: "After signing in, your browser's address bar will show a URL that looks like:\n\nremoteplay.dl.playstation.net/remoteplay/redirect?code=XXXXX...\n\nCopy the full URL from the address bar. You will paste it on the next screen."
        }
      );
    }

    if (setupStep === 2) {
      // After redirect URL instructions — show input field
      setupStep = 3;
      return new uc.RequestUserInput({ en: "Paste Redirect URL" }, [
        {
          id: REDIRECT_URL_FIELD,
          label: { en: "Redirect URL" },
          field: { text: { value: "" } }
        }
      ]);
    }

    if (setupStep === 4) {
      // After PIN instructions — show PIN input field
      setupStep = 5;
      return new uc.RequestUserInput({ en: "Enter PIN" }, [
        {
          id: PIN_FIELD,
          label: { en: "8-digit PIN from your TV" },
          field: { text: { value: "" } }
        }
      ]);
    }

    return new uc.SetupError();
  }

  if (msg instanceof uc.UserDataResponse) {
    // Step 3: Redirect URL submitted — exchange for accountId
    if (setupStep === 3) {
      const redirectUrl = msg.inputValues[REDIRECT_URL_FIELD];
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

      // Show PIN instructions
      setupStep = 4;
      return new uc.RequestUserConfirmation(
        { en: "Step 3: Pair with your PS5" },
        {
          en: "On your PS5, go to Settings > System > Remote Play > Pair Device. An 8-digit PIN will appear on your TV.\n\nMake sure your PS5 is powered on (not in rest mode) and on the same network as your remote."
        }
      );
    }

    // Step 5: PIN submitted — discover PS5 and register
    if (setupStep === 5) {
      const pin = msg.inputValues[PIN_FIELD];
      if (!pin || !/^\d{8}$/.test(pin.trim())) {
        console.error("[ps5] Invalid PIN (must be 8 digits)");
        return new uc.SetupError(uc.IntegrationSetupError.Other);
      }

      try {
        console.log("[ps5] Discovering PS5 on network...");
        const discovered = await Device.any().discover();
        console.log(`[ps5] Found ${discovered.name} (${discovered.id}) — ${discovered.status}`);

        if (discovered.status !== DeviceStatus.AWAKE) {
          console.error("[ps5] PS5 must be powered on for registration");
          return new uc.SetupError(uc.IntegrationSetupError.ConnectionRefused);
        }

        console.log("[ps5] Registering with PS5...");
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
        setupAccountId = null;

        console.log("[ps5] Registration complete");
        return new uc.SetupComplete();
      } catch (err) {
        console.error("[ps5] Registration failed:", err instanceof Error ? err.message : err);
        setupAccountId = null;
        return new uc.SetupError(uc.IntegrationSetupError.Other);
      }
    }

    return new uc.SetupError();
  }

  if (msg instanceof uc.AbortDriverSetup) {
    console.log("[ps5] Setup aborted");
    setupAccountId = null;
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

console.log("[ps5] PS5 Power integration driver started");
