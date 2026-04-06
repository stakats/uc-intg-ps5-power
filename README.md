# PS5 Power — Unfolded Circle Integration

Wake and put your PS5 into standby from your [Unfolded Circle Remote 3](https://www.unfoldedcircle.com/).

## Prerequisites

- A PS5 on the same local network as your UC Remote 3
- A phone or computer with a browser (for one-time PSN sign-in during setup)

## Step 1: Configure your PS5

Before setup, you need to enable two settings on your PS5. These are PS5 requirements for any Remote Play or wake-from-network functionality — they only need to be set once.

1. Go to **Settings > System > Remote Play** and turn on **Enable Remote Play**.
2. Go to **Settings > System > Power Saving > Features Available in Rest Mode** and turn on **Stay Connected to the Internet**.

Without these settings, the PS5 cannot be woken from rest mode over the network.

## Step 2: Install on UC Remote 3

1. Download `uc-intg-ps5-power.tar.gz` from the [latest release](https://github.com/stakats/uc-intg-ps5-power/releases/latest).

2. Open your UC Remote's web configurator (browse to your remote's IP address).

3. Go to **Settings > Integrations > Add > Upload custom integration** and upload the `.tar.gz` file.

## Step 3: Pair with your PS5

The integration includes a guided setup flow. Make sure your PS5 is **powered on** (not in rest mode) before starting.

1. When adding the integration, you'll be shown a PlayStation Network sign-in URL. Open it in a browser on your phone or computer and sign in.
2. After signing in, copy the redirect URL from your browser's address bar and paste it when prompted.
3. On your PS5, go to **Settings > System > Remote Play > Pair Device**. Enter the 8-digit PIN shown on your TV when prompted.
4. The integration will register with your PS5 and complete setup.

## Step 4: Use it

Add the **PS5** entity to a profile or activity on your remote. Assign wake (on) and standby (off) to buttons or include it in an activity power-on/off sequence.

## Troubleshooting

- **Pairing fails**: The PS5 must be fully powered on (not in rest mode) and on the same network as your remote.
- **PS5 won't wake from rest mode**: Make sure you enabled both settings in Step 1 — Remote Play and Stay Connected to the Internet in rest mode. These are PS5 requirements.
- **PS5 not found during pairing**: Ensure your PS5 and UC Remote are on the same local network.
- **Activity shows error after remote reboot**: The integration takes about 15 seconds to start after the remote reboots. Wait before triggering a PS5 activity.
- **Reconfiguring credentials**: Remove the integration on the remote and re-add it to go through the setup flow again.

## Notes

- This integration uses [playactor](https://github.com/dhleong/playactor) under the hood.

## Development

```bash
npm install                # Install dependencies
npm run build              # Compile TypeScript
npm start                  # Run the driver locally
npm test                   # Run tests
npm run package            # Build deployment archive
npm run code-check         # Check formatting & linting
```
