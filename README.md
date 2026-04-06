# PS5 Power — Unfolded Circle Integration

Wake and put your PS5 into standby from your [Unfolded Circle Remote 3](https://www.unfoldedcircle.com/).

## Prerequisites

- A PS5 on the same local network as your UC Remote 3
- A computer (macOS, Windows, or Linux) to run the one-time pairing process
- Node.js installed on that computer (see below)

## Step 1: Install Node.js

You only need Node.js on your computer for the one-time pairing step. It is not installed on the remote.

- **macOS**: `brew install node` or download from [nodejs.org](https://nodejs.org/)
- **Windows**: Download the installer from [nodejs.org](https://nodejs.org/)
- **Linux**: `sudo apt install nodejs npm` (Debian/Ubuntu) or see [nodejs.org](https://nodejs.org/)

Verify it's installed:

```bash
node --version
npx --version
```

## Step 2: Configure your PS5

Before pairing, you need to enable two settings on your PS5. These are PS5 requirements for any Remote Play or wake-from-network functionality — they only need to be set once.

1. Go to **Settings > System > Remote Play** and turn on **Enable Remote Play**.
2. Go to **Settings > System > Power Saving > Features Available in Rest Mode** and turn on **Stay Connected to the Internet**.

Without these settings, the PS5 cannot be woken from rest mode over the network.

## Step 3: Pair with your PS5

This is a one-time process that registers your computer with the PS5. It generates credentials that the integration uses to send wake and standby commands. You will not need to repeat this unless you re-pair.

1. **Power on your PS5** (it must be fully on, not in rest mode) and make sure it's on the same network as your computer.

2. On your computer, run:

   ```bash
   npx playactor login --ps5
   ```

3. A browser window will open for you to **sign in to your PlayStation Network account**. After signing in, the page will show "redirect". **Copy the URL from your browser's address bar** and paste it back into the terminal.

4. On your PS5, go to **Settings > System > Remote Play > Link Device**. A PIN will appear on your TV.

5. **Enter the PIN** into the terminal when prompted.

6. Pairing is complete. Your credentials are saved to:
   - **macOS / Linux**: `~/.config/playactor/credentials.json`
   - **Windows**: `C:\Users\<your-username>\.config\playactor\credentials.json`

## Step 4: Install on UC Remote 3

1. Download `uc-intg-ps5-power.tar.gz` from the [latest release](https://github.com/stakats/uc-intg-ps5-power/releases/latest).

2. Open your UC Remote's web configurator (browse to your remote's IP address).

3. Go to **Settings > Integrations > Add > Upload custom integration** and upload the `.tar.gz` file.

## Step 5: Add your credentials

When the integration is added, a setup screen will appear with a text box.

1. Open the `credentials.json` file from Step 3 in a text editor.
2. **Copy the entire contents** and paste them into the text box on the remote's setup screen.
3. Confirm the setup.

## Step 6: Use it

Add the **PS5** entity to a profile or activity on your remote. Assign wake (on) and standby (off) to buttons or include it in an activity power-on/off sequence.

## Troubleshooting

- **Pairing fails**: The PS5 must be fully powered on (not in rest mode) and on the same network as your computer.
- **PS5 won't wake from rest mode**: Make sure you enabled both settings in Step 2 — Remote Play and Stay Connected to the Internet in rest mode. These are PS5 requirements.
- **PS5 not found during pairing**: Try specifying the IP directly: `npx playactor login --ps5 --ip 192.168.1.XXX`
- **Activity shows error after remote reboot**: The integration takes about 15 seconds to start after the remote reboots. Wait before triggering a PS5 activity.
- **Reconfiguring credentials**: Remove the integration on the remote and re-add it to go through the setup screen again.

## Notes

- Wake takes around 15-20 seconds to complete (network discovery + wake).
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
