# PS5 Power — Unfolded Circle Integration Driver

Wake and put your PS5 into standby from your Unfolded Circle Remote 3, using [playactor](https://github.com/dhleong/playactor) under the hood.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Log in with playactor (one-time, on dev machine)

```bash
npx playactor login
```

Follow the OAuth flow — it saves credentials to `~/.config/playactor/`. You only need to do this once.

### 3. Verify playactor works

Put your PS5 in rest mode, then:

```bash
npx playactor wake
npx playactor standby
```

Both should work before proceeding.

### 4. Build and run

```bash
npm run build
npm start
```

Or with debug logging:

```bash
npm run start:debug
```

The driver starts a WebSocket server on port `9090` and advertises itself via mDNS.

## Deploy to UC Remote 3

### Build the package

```bash
npm run package
```

This produces `uc-intg-ps5-power.tar.gz`.

### Install on the remote

Upload the `.tar.gz` via the UC Remote web configurator:

**Settings → Integrations → Add → Upload custom integration**

### Provision playactor credentials

The `playactor login` OAuth flow requires a browser, so it must be run on your dev machine first:

1. Run `npx playactor login` on your dev machine.
2. When adding the integration on the remote, a setup screen will prompt you to paste the contents of `~/.config/playactor/credentials.json` from your dev machine.
3. The integration saves the credentials to its on-device config directory.

To reconfigure credentials later, remove and re-add the integration.

After setup, add the PS5 entity to a profile and assign wake/standby to buttons.

## Development

```bash
npm run build          # Compile TypeScript
npm start              # Run the driver
npm run start:debug    # Run with debug logging
npm test               # Run tests
npm run package        # Build deployment archive
npm run code-check     # Check formatting & linting
```

## Notes

- State is optimistic — the remote shows ON/OFF based on the last command sent, not actual PS5 state.
- playactor credentials are stored in `~/.config/playactor/` — if you move to another machine, re-run `playactor login`.
