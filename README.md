# PlayStation Power — Unfolded Circle Integration

Wake and put your PlayStation (PS4 or PS5) into standby from your [Unfolded Circle Remote 3](https://www.unfoldedcircle.com/).

## Prerequisites

- A PS4 or PS5 on the same local network as your UC Remote 3
- A phone or computer with a browser (for one-time PSN sign-in during setup)

## Step 1: Configure your PlayStation

Before setup, enable these settings on your PlayStation so it can be woken over the network. These only need to be set once.

**PS5:**

1. Settings > System > Remote Play > **Enable Remote Play**
2. Settings > System > Power Saving > Features Available in Rest Mode > **Stay Connected to the Internet**

**PS4:**

1. Settings > Remote Play Connection Settings > **Enable Remote Play**
2. Settings > Power Save Settings > Set Features Available in Rest Mode > **Stay Connected to the Internet**
3. Settings > Power Save Settings > Set Features Available in Rest Mode > **Enable Turning On PS4 from Network**

## Step 2: Install on UC Remote 3

1. Download `uc-intg-ps5-power.tar.gz` from the [latest release](https://github.com/stakats/uc-intg-ps5-power/releases/latest).

2. Open your UC Remote's web configurator (browse to your remote's IP address).

3. Go to **Settings > Integrations > Add > Upload custom integration** and upload the `.tar.gz` file.

## Step 3: Pair with your PlayStation

The integration includes a guided setup flow. Make sure your PlayStation is **powered on** (not in rest mode) before starting.

1. When adding the integration, you'll be shown a PlayStation Network sign-in URL. Open it in a browser on your phone or computer and sign in.
2. After signing in, copy the redirect URL from your browser's address bar and paste it when prompted.
3. On your PlayStation, navigate to the pairing screen:

   - **PS5**: Settings > System > Remote Play > Pair Device
   - **PS4**: Settings > Remote Play Connection Settings > Add Device

   Enter the 8-digit PIN shown on your TV when prompted.

4. The integration will register with your PlayStation and complete setup.

## Step 4: Use it

Add the **PlayStation** entity to a profile or activity on your remote. Assign wake (on) and standby (off) to buttons or include it in an activity power-on/off sequence.

## Troubleshooting

- **Pairing fails**: Your PlayStation must be fully powered on (not in rest mode) and on the same network as your remote.
- **Won't wake from rest mode**: Make sure you enabled both settings in Step 1 — Remote Play and Stay Connected to the Internet in rest mode.
- **PlayStation not found during pairing**: Ensure your PlayStation and UC Remote are on the same local network.
- **Activity shows error after remote reboot**: The integration takes about 15 seconds to start after the remote reboots. Wait before triggering an activity.
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
