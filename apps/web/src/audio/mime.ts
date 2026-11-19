/**
 * The string handed to canPlayType for a file's server-reported MIME type. Browsers do not recognise every registered name
 * for what they can in fact play: "audio/opus" (an Ogg Opus file) probes as unsupported although it plays, and the x-m4a/
 * x-m4b aliases are MP4 audio. Probing the container type with its codec gives the real answer (T007 F5).
 */
export function probeType(mime: string): string {
  switch (mime.toLowerCase().split(";")[0].trim()) {
    case "audio/opus":
      return 'audio/ogg; codecs="opus"';
    case "audio/x-m4a":
    case "audio/x-m4b":
      return "audio/mp4";
    default:
      return mime;
  }
}
