# WhatsApp Chat Time Calculator

Simple typescript code to calculate total time spent on WhatsApp chats based on exported chat .txt data.

## Features

- Parses WhatsApp chat export files.txt
- Calculates total time spent in chats per day and total of all chats.
- Outputs results in a user-friendly format.

## First Time Setup

1. Ensure you have Node.js and npm installed.
2. Clone this repository.
3. Navigate to the project directory.
4. Install dependencies:

```bash
npm install
```

## Usage

1. Export your WhatsApp chat as a .txt file.
2. Import file to chats directory and rename it to a unique name (e.g., "xChat.txt").
3. Run the TypeScript code with the exported file.

```bash
node whatsapp-chat-time.ts "chats/xChat.txt" --gap=3
```

4. View the calculated time spent in chats in console. Which will look like this:

```bash
=== WhatsApp Chat Time Calculator ===

File: chat.txt
Detected date order: MDY
Gap threshold: 3 minute(s)
Conversation count method: start

=== Daily Report ===
  2025-09-26  |  conversations:   2  |  duration: 0h 0m   (0 min)
  2025-09-27  |  conversations:   1  |  duration: 0h 1m   (1 min)
  2025-09-28  |  conversations:  14  |  duration: 0h 20m  (20 min)
  2025-09-29  |  conversations:  14  |  duration: 0h 17m  (17 min)
  2025-09-30  |  conversations:   9  |  duration: 0h 10m  (10 min)
  2025-10-02  |  conversations:  24  |  duration: 0h 23m  (23 min)
  2025-10-03  |  conversations:   1  |  duration: 0h 0m   (0 min)
  2025-10-05  |  conversations:   1  |  duration: 0h 3m   (3 min)
  2025-10-06  |  conversations:   5  |  duration: 0h 13m  (13 min)

=== Monthly Report ===
  2025-09      |  conversations: 40  |  duration: 0h 48m  (48 min)
  2025-10      |  conversations: 31  |  duration: 0h 39m  (39 min)

=== All File Totals ===
  conversations: 71
  total duration: 1h 27m  (87 min)

```

## How It Works

1. The script reads the WhatsApp chat export .txt file line by line.
2. It identifies timestamps and groups messages into conversations based on a specified time gap (default is 5, override in running command above).
3. It calculates the duration of each conversation and aggregates the data by day and month.
4. Finally, it outputs the results in structured format as above.

## Configuration

- `--gap`: (optional) Minimum gap in minutes to consider separate chat sessions. Default is 3 minutes.
- `--output`: (optional) Specify output file to save results. Default is console output.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request for any improvements or bug fixes.

## License

This project is licensed under the MIT License. See the LICENSE file for details.

## Acknowledgements

- Inspired by the need to track time spent on WhatsApp chats for productivity analysis.
- Thanks to the open-source community for tools and libraries used in this project.

## Authors

- Makkahwi - Initial work and ongoing maintenance.
- ChatGPT - Assistance with code suggestions.
- CoPilot - Documentation completion and suggestions.
