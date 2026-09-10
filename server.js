const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 500 * 1024 * 1024 },
});
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.static(path.join(__dirname)));

const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

const cleanUpFile = (filePath) => {
    fs.unlink(filePath, (err) => {
        if (err) {
            console.error('Cleanup error:', err);
        }
    });
};

const requestGemini = async(url, body) => {
    let lastError = 'Gemini transcription failed.';
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const payload = await response.json();
        if (response.ok) return payload;
        lastError = (payload.error && payload.error.message) || lastError;
        const retryable = response.status === 429 || response.status >= 500 || /high demand|temporarily|try again/i.test(lastError);
        if (!retryable || attempt === 2) throw new Error(lastError);
        await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
    throw new Error(lastError);
};

app.post('/api/transcribe', upload.single('audio'), async(req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Audio file is required.' });
    }

    const filePath = path.resolve(req.file.path);

    try {
        if (!process.env.GEMINI_API_KEY) {
            throw new Error('GEMINI_API_KEY is required to transcribe an uploaded session.');
        }

        const audioData = fs.readFileSync(filePath).toString('base64');
        const geminiPayload = await requestGemini(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
            contents: [{
                parts: [
                    { text: 'Transcribe this recording with speaker diarization. Return ONLY valid JSON in this exact shape: {"segments":[{"startMs":0,"endMs":1000,"speaker":"Male_1","text":"..."}]}. Use millisecond integers and preserve the exact spoken words. Identify each distinct voice from the audio and assign a stable label: Male_1, Male_2 for male voices and Female_1, Female_2 for female voices. Reuse the same label every time that person speaks. Never alternate labels by segment.' },
                    { inline_data: { mime_type: req.file.mimetype || 'audio/mpeg', data: audioData } },
                ]
            }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
        });
        const candidate = geminiPayload.candidates && geminiPayload.candidates[0];
        const parts = candidate && candidate.content && candidate.content.parts;
        const responsePart = parts && parts.find((part) => part.text);
        const responseText = responsePart ? responsePart.text : '';
        const transcription = JSON.parse(responseText.replace(/^```json\s*|\s*```$/g, '').trim());

        if (!Array.isArray(transcription.segments) || transcription.segments.length === 0) {
            throw new Error('Transcription returned no text.');
        }

        let cursorMs = Number(transcription.segments[0].startMs) || 0;
        const segments = transcription.segments.map((segment, index) => {
            const startMs = cursorMs;
            const requestedEndMs = Number(segment.endMs) || startMs + 5000;
            const endMs = Math.max(startMs + 1, requestedEndMs);
            cursorMs = endMs;
            const speaker = segment.speaker || 'Male_1';
            const text = segment.text || '';
            return { startMs, endMs, speaker, text };
        });

        const result = segments.length > 0 ? segments : [{ startMs: 0, endMs: 5000, speaker: 'Male_1', text: transcription.text }];
        return res.json({ sessionId: path.basename(req.file.filename), fileName: req.file.originalname, segments: result });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: error && error.message || 'Transcription failed.' });
    } finally {
        cleanUpFile(filePath);
    }
});

app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Recording is too large. Maximum upload size is 500 MB.' });
    }
    if (error) {
        console.error(error);
        return res.status(500).json({ error: 'Upload failed. Please try the recording again.' });
    }
    return next();
});

app.listen(port, () => {
    console.log(`Verbatim Pro server is running at http://localhost:${port}`);
});