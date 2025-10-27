import { Client } from "@gradio/client";

const app = await Client.connect("http://127.0.0.1:7860/");
					
await app.predict(
  "/predict",
							{
    prompt: "Me cago, me cago, me cago y me vuelvo a cagar",
    language: "es",
    audio_file_pth: {"path":"C:\\pinokio\\api\\xtts.pinokio.git\\cache\\GRADIO_TEMP_DIR\\4c0265ab6819363c98f123a3b4a7404b5efe9cd1b3d1181c98872e6c71e57d57\\Vídeo sin título  Hecho con Clipchamp.wav","url":"http://127.0.0.1:7860/file=C:\\pinokio\\api\\xtts.pinokio.git\\cache\\GRADIO_TEMP_DIR\\4c0265ab6819363c98f123a3b4a7404b5efe9cd1b3d1181c98872e6c71e57d57\\Vídeo sin título  Hecho con Clipchamp.wav","orig_name":"Vídeo sin título ‐ Hecho con Clipchamp.wav","size":464968,"mime_type":"audio/wav","meta":{"_type":"gradio.FileData"}},
    agree: true,
});
console.log("Audio generado con éxito.");
