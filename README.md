<h1 align="center">
  FrogPhone
</h1>

## About

FrogPhone is a very minimal & lightweight version of [phonesense](https://github.com/snappyxo/phonesense) made in TypeScript instead of Python.

### Endpoints

Camera:

- `/phone` - Prompts for camera access and sends camera feed to `/ingest`.
- `/ingest` - Receives camera feed and stores the latest frame in memory.
- `/camera` - View the latest frame that your camera captured.

LED display: 

- `/display` - Turns the screen into an LED board (~24px per LED, change with `?size=`). Tap once for fullscreen.
- `/display/led` - `GET` returns the board size and pixels, `POST` lets you draw on it.

## How to use FrogPhone

1. Install and run FrogPhone using the following command:
```bash
npx frogphone
```
2. On your phone, go to the URL that it printed.
3. Accept the camera access prompt.
4. Done! You now use the `/camera` endpoint to view the latest frame that your camera captured.

## License

This project is licensed under the MIT [LICENSE](./LICENSE.md).
