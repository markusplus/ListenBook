const dropArea = document.getElementById('upload_section');

dropArea.addEventListener('dragover', (event) => {
    event.preventDefault();
    dropArea.classList.add('dragging');
});

dropArea.addEventListener('dragleave', () => {
    dropArea.classList.remove('dragging');
});

dropArea.addEventListener('drop', (event) => {
    event.preventDefault();
    dropArea.classList.remove('dragging');
    const files = event.dataTransfer.files;
    document.getElementById('file-upload').files = files;
    archivoSubido();
});
const fileInput = document.getElementById('file-upload');
const uploadSection = document.getElementById('upload_section');

fileInput.addEventListener('change', () => {
    archivoSubido();
});

const archivoSubido = () => {
    if (fileInput.files.length > 0) {
        console.log('Archivo subido');
        document.getElementById('header_container').style.display = 'none';
        document.getElementById('configuracion_section').style.display = 'block';
        speak();
    }
}

function speak() {
    const utterance = new SpeechSynthesisUtterance("¡Bienvenido a este tutorial!");

    const voices = speechSynthesis.getVoices();
    voices.forEach(voice => {
        console.log(voice.name);
    });
    const spanishVoice = voices.find(voice => voice.lang.startsWith('es'));
    if (spanishVoice) {
        utterance.voice = spanishVoice;
    }

    speechSynthesis.speak(utterance);
}