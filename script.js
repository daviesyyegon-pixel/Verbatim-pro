const $ = (id) => document.getElementById(id);
const audioFileInput = $('audioFile');
const audioPlayer = $('audioPlayer');
const segmentsContainer = $('segments');
const exportText = $('exportText');
const statusMessage = $('statusMessage');
let transcriptSegments = [];
let history = [];
let future = [];
let recordingDuration = 36000;

const createSegment = (startMs, endMs, speaker, text) => ({ startMs, endMs, speaker, text });
const pad = (value, length = 2) => String(Math.max(0, Math.floor(value))).padStart(length, '0');
const formatTimestamp = (ms, short = false) => {
    const total = Math.max(0, Math.floor(ms));
    const hours = Math.floor(total / 3600000);
    const minutes = Math.floor((total % 3600000) / 60000);
    const seconds = Math.floor((total % 60000) / 1000);
    const millis = total % 1000;
    return short ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}:${pad(millis, 3)}`;
};
const parseTimestamp = (value) => {
    const parts = value.trim().replace(/[\[\]]/g, '').split(':').map(Number);
    if (parts.length !== 4 || parts.some(Number.isNaN)) return null;
    return parts[0] * 3600000 + parts[1] * 60000 + parts[2] * 1000 + parts[3];
};
const setStatus = (message, error = false) => {
    statusMessage.textContent = message;
    statusMessage.dataset.error = error;
};
const snapshot = () => JSON.stringify(transcriptSegments);
const pushHistory = () => {
    history.push(snapshot());
    if (history.length > 50) history.shift();
    future = [];
};
const beginEdit = (element) => {
    if (element.dataset.historySnapshot === undefined) element.dataset.historySnapshot = snapshot();
};
const commitEdit = (element) => {
    if (element.dataset.historySnapshot === undefined) return;
    history.push(element.dataset.historySnapshot);
    if (history.length > 50) history.shift();
    future = [];
    delete element.dataset.historySnapshot;
};

const normalizeSegments = (segments) => {
    let cursor = Number(segments.length ? segments[0].startMs : 0) || 0;
    return segments.map((segment, index) => {
        const startMs = cursor;
        const requestedEnd = Number(segment.endMs) || startMs + 5000;
        const endMs = Math.max(startMs + 1, requestedEnd);
        cursor = endMs;
        return createSegment(startMs, endMs, segment.speaker || 'Male_1', segment.text || '');
    });
};
const updateStats = () => {
    const words = transcriptSegments.reduce((total, segment) => total + segment.text.trim().split(/\s+/).filter(Boolean).length, 0);
    const speakers = new Set(transcriptSegments.map((segment) => segment.speaker).filter(Boolean));
    $('wordStat').textContent = words.toLocaleString();
    $('speakerStat').textContent = speakers.size;
    $('durationStat').textContent = formatTimestamp(recordingDuration, true);
    $('totalTime').textContent = `/ ${formatTimestamp(recordingDuration, true)}`;
    $('segmentCount').textContent = `${transcriptSegments.length} segment${transcriptSegments.length === 1 ? '' : 's'}`;
    $('endMarker').textContent = formatTimestamp(recordingDuration);
};
const buildSpeakerFirstText = () => transcriptSegments.map((segment) => `${segment.speaker.replace(/:\s*$/, '')}:\n[${formatTimestamp(segment.startMs)} --> ${formatTimestamp(segment.endMs)}]\n${segment.text}`).join('\n\n') + (transcriptSegments.length ? `\n\nEnd of recording --> [${formatTimestamp(recordingDuration)}]` : '');
const buildSrt = () => transcriptSegments.map((segment, index) => `${index + 1}\n${formatTimestamp(segment.startMs).replace(/:(\d{3})$/, ',$1')} --> ${formatTimestamp(segment.endMs).replace(/:(\d{3})$/, ',$1')}\n${segment.speaker}: ${segment.text}`).join('\n\n');
const buildVtt = () => `WEBVTT\n\n${transcriptSegments.map((segment) => `${formatTimestamp(segment.startMs).replace(/:(\d{3})$/, '.$1')} --> ${formatTimestamp(segment.endMs).replace(/:(\d{3})$/, '.$1')}\n${segment.speaker}: ${segment.text}`).join('\n\n')}`;
const buildJson = () => JSON.stringify({ duration: formatTimestamp(recordingDuration), segments: transcriptSegments.map((segment) => ({ speaker: segment.speaker, start: formatTimestamp(segment.startMs), end: formatTimestamp(segment.endMs), text: segment.text })), endOfRecording: formatTimestamp(recordingDuration) }, null, 2);

const buildSegment = (segment, index) => {
    const card = document.createElement('article');
    card.className = 'segment'; card.dataset.start = segment.startMs;
    card.addEventListener('click', (event) => { if (!event.target.closest('input, textarea, button')) seekTo(segment.startMs); });
    const top = document.createElement('div'); top.className = 'segment-top';
    const indexLabel = document.createElement('span'); indexLabel.className = 'segment-index'; indexLabel.textContent = String(index + 1).padStart(2, '0');
    const speaker = document.createElement('input'); speaker.className = `speaker-input ${/^female/i.test(segment.speaker) ? 'female-speaker' : 'male-speaker'}`; speaker.value = segment.speaker; speaker.setAttribute('aria-label', 'Speaker');
    speaker.addEventListener('focus', () => beginEdit(speaker));
    speaker.addEventListener('change', () => { segment.speaker = speaker.value.trim() || 'Male_1'; commitEdit(speaker); render(); });
    const remove = document.createElement('button'); remove.className = 'delete-button'; remove.textContent = '×'; remove.title = 'Delete segment';
    remove.addEventListener('click', () => { pushHistory(); transcriptSegments.splice(index, 1); render(); setStatus('Segment deleted.'); });
    top.append(indexLabel, speaker, remove);
    const times = document.createElement('div'); times.className = 'time-row';
    const start = document.createElement('input'); start.value = formatTimestamp(segment.startMs); start.disabled = true; start.title = 'Start follows the previous segment end';
    const end = document.createElement('input'); end.value = formatTimestamp(segment.endMs); end.setAttribute('aria-label', 'End timestamp');
    end.addEventListener('focus', () => beginEdit(end));
    end.addEventListener('change', () => { const parsed = parseTimestamp(end.value); if (parsed !== null) segment.endMs = parsed; commitEdit(end); transcriptSegments = normalizeSegments(transcriptSegments); render(); });
    times.append(document.createTextNode('['), start, document.createTextNode(' --> '), end, document.createTextNode(']'));
    const text = document.createElement('textarea'); text.value = segment.text; text.setAttribute('aria-label', 'Segment text');
    text.addEventListener('focus', () => beginEdit(text));
    text.addEventListener('input', () => { segment.text = text.value; exportText.value = buildSpeakerFirstText(); updateStats(); $('saveState').textContent = 'Unsaved changes'; });
    text.addEventListener('change', () => { commitEdit(text); $('saveState').textContent = 'All changes saved'; });
    const actions = document.createElement('div'); actions.className = 'segment-actions';
    const split = document.createElement('button'); split.className = 'text-button'; split.textContent = 'Split segment'; split.addEventListener('click', () => { pushHistory(); const midpoint = segment.startMs + Math.floor((segment.endMs - segment.startMs) / 2); const words = segment.text.trim().split(/\s+/); const half = Math.max(1, Math.ceil(words.length / 2)); segment.text = words.slice(0, half).join(' '); transcriptSegments.splice(index + 1, 0, createSegment(midpoint, segment.endMs, segment.speaker, words.slice(half).join(' '))); render(); });
    const merge = document.createElement('button'); merge.className = 'text-button'; merge.textContent = 'Merge next'; merge.disabled = index === transcriptSegments.length - 1; merge.addEventListener('click', () => { pushHistory(); const next = transcriptSegments[index + 1]; segment.endMs = next.endMs; segment.text = `${segment.text} ${next.text}`.trim(); transcriptSegments.splice(index + 1, 1); render(); });
    actions.append(split, merge); card.append(top, times, text, actions); return card;
};
const render = () => { segmentsContainer.innerHTML = ''; $('emptyState').classList.toggle('hidden', transcriptSegments.length > 0); transcriptSegments.forEach((segment, index) => segmentsContainer.appendChild(buildSegment(segment, index))); exportText.value = buildSpeakerFirstText(); updateStats(); };
const loadSegments = (segments, message = 'Transcript loaded.') => { transcriptSegments = normalizeSegments(segments); history = []; future = []; render(); setStatus(message); };
const loadSample = () => { recordingDuration = 33530; $('documentName').textContent = 'geometry-lecture.mp3'; $('fileName').textContent = 'geometry-lecture.mp3'; $('sessionName').textContent = 'geometry-lecture.mp3'; $('sessionStatus').textContent = 'Sample session · AI-ready'; loadSegments([createSegment(7340, 10200, 'Male_1', 'Called gravitational lensing.'), createSegment(10200, 18240, 'Male_1', 'So, this is the idea. Okay?'), createSegment(18240, 28440, 'Male_1', 'So, this motivate- motivates us to study geometry related to Einstein\'s equations. And these are called Einstein metrics.'), createSegment(28440, 33530, 'Male_1', 'So, now I\'m going to do a bit of math’s. This is going to be the math’s slide. Okay?')], 'Sample transcript ready.'); };
const seekTo = (ms) => { if (!audioPlayer.src) { setStatus(`Playback point: ${formatTimestamp(ms, true)}`); return; } audioPlayer.currentTime = ms / 1000; audioPlayer.play().catch(() => {}); };
const download = (content, name, type = 'text/plain') => { const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url); };
const copySession = async () => { const text = buildSpeakerFirstText(); if (!text) { setStatus('Add a transcript before copying.', true); return; } try { await navigator.clipboard.writeText(text); } catch { exportText.focus(); exportText.select(); document.execCommand('copy'); } setStatus('Transcript copied to clipboard.'); };
const parseTranscript = () => { const lines = $('rawTranscript').value.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean); const parsed = []; for (let index = 0; index < lines.length; index += 3) { const range = lines[index + 1] && lines[index + 1].match(/(.+?)\s*-->\s*(.+)/); if (!range) continue; const startMs = parseTimestamp(range[1]); const endMs = parseTimestamp(range[2]); if (startMs !== null && endMs !== null) parsed.push(createSegment(startMs, endMs, lines[index], lines[index + 2] || '')); } if (!parsed.length) { setStatus('Use speaker, timestamp range, then text on separate lines.', true); return; } const lastSegment = parsed[parsed.length - 1]; recordingDuration = Math.max(recordingDuration, lastSegment.endMs); loadSegments(parsed, 'Transcript imported.'); };
const addSegment = () => { const lastSegment = transcriptSegments[transcriptSegments.length - 1]; const startMs = lastSegment ? lastSegment.endMs : 0; pushHistory(); transcriptSegments.push(createSegment(startMs, startMs + 5000, 'Male_1', 'New segment')); render(); setStatus('Segment added.'); };
const undo = () => { if (!history.length) return; future.push(snapshot()); transcriptSegments = JSON.parse(history.pop()); render(); setStatus('Last edit undone.'); };
const redo = () => { if (!future.length) return; history.push(snapshot()); transcriptSegments = JSON.parse(future.pop()); render(); setStatus('Edit restored.'); };

$('uploadTrigger').addEventListener('click', () => audioFileInput.click()); $('emptyUpload').addEventListener('click', () => audioFileInput.click());
audioFileInput.addEventListener('change', () => { const file = audioFileInput.files[0]; if (!file) return; audioPlayer.src = URL.createObjectURL(file); $('fileName').textContent = file.name; $('documentName').textContent = file.name; $('sessionName').textContent = file.name; $('sessionStatus').textContent = 'Recording uploaded · ready for AI'; setStatus('Recording uploaded. Ready to transcribe with AI.'); });
audioPlayer.addEventListener('loadedmetadata', () => { if (Number.isFinite(audioPlayer.duration)) { recordingDuration = Math.round(audioPlayer.duration * 1000); updateStats(); } });
audioPlayer.addEventListener('timeupdate', () => { $('currentTime').textContent = formatTimestamp((audioPlayer.currentTime || 0) * 1000, true); document.querySelectorAll('.segment').forEach((card, index) => { const nextSegment = transcriptSegments[index + 1]; const nextStart = nextSegment ? nextSegment.startMs : Infinity; card.classList.toggle('playing', Number(card.dataset.start) <= audioPlayer.currentTime * 1000 && nextStart > audioPlayer.currentTime * 1000); }); });
$('playButton').addEventListener('click', () => audioPlayer.paused ? audioPlayer.play().catch(() => {}) : audioPlayer.pause()); audioPlayer.addEventListener('play', () => { $('playButton').textContent = 'Ⅱ'; }); audioPlayer.addEventListener('pause', () => { $('playButton').textContent = '▶'; }); $('skipBack').addEventListener('click', () => { audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - 5); }); $('skipForward').addEventListener('click', () => { audioPlayer.currentTime = Math.min(audioPlayer.duration || recordingDuration / 1000, audioPlayer.currentTime + 5); });
$('clearAudio').addEventListener('click', () => { audioPlayer.removeAttribute('src'); audioPlayer.load(); audioFileInput.value = ''; recordingDuration = 0; transcriptSegments = []; history = []; future = []; $('fileName').textContent = 'No recording loaded'; $('documentName').textContent = 'Untitled recording'; $('sessionName').textContent = 'Not started'; $('sessionStatus').textContent = 'Upload audio to begin'; render(); setStatus('Recording and transcript cleared.'); }); $('generateSample').addEventListener('click', loadSample); $('parseTranscript').addEventListener('click', parseTranscript); $('addSegment').addEventListener('click', addSegment); $('undoButton').addEventListener('click', undo); $('redoButton').addEventListener('click', redo);
$('searchToggle').addEventListener('click', () => { $('searchBar').classList.toggle('hidden'); $('searchInput').focus(); }); $('closeSearch').addEventListener('click', () => $('searchBar').classList.add('hidden'));
const replaceText = (all) => { const find = $('searchInput').value; if (!find) return; pushHistory(); transcriptSegments.forEach((segment) => { segment.text = all ? segment.text.split(find).join($('replaceInput').value) : segment.text.replace(find, $('replaceInput').value); }); render(); setStatus(all ? 'All matches replaced.' : 'Match replaced.'); }; $('replaceButton').addEventListener('click', () => replaceText(false)); $('replaceAllButton').addEventListener('click', () => replaceText(true));
$('transcribeButton').addEventListener('click', async () => { const file = audioFileInput.files[0]; if (!file) { setStatus('Upload a recording before transcribing.', true); return; } $('transcribeButton').disabled = true; $('transcribeButton').textContent = 'Transcribing...'; $('sessionStatus').textContent = 'Gemini transcription and speaker detection in progress'; setStatus('Gemini is transcribing and detecting speakers. Longer recordings may take a minute...'); try { const form = new FormData(); form.append('audio', file); const response = await fetch('/api/transcribe', { method: 'POST', body: form }); const result = await response.json(); if (!response.ok) throw new Error(result.error); const resultSegments = Array.isArray(result.segments) ? result.segments : []; const lastSegment = resultSegments[resultSegments.length - 1]; if (lastSegment) recordingDuration = Math.max(recordingDuration, lastSegment.endMs || 0); loadSegments(resultSegments, 'Gemini transcript ready.'); $('sessionStatus').textContent = 'Gemini transcript ready · speakers detected'; } catch (error) { $('sessionStatus').textContent = 'Gemini transcription failed'; setStatus(error.message || 'Transcription failed.', true); } finally { $('transcribeButton').disabled = false; $('transcribeButton').textContent = 'Transcribe with Gemini →'; } });
document.querySelectorAll('[data-export]').forEach((button) => button.addEventListener('click', () => { const format = button.dataset.export; if (!transcriptSegments.length) { setStatus('Add a transcript before exporting.', true); return; } if (format === 'pdf') { const printWindow = window.open('', '_blank'); printWindow.document.write(`<pre>${buildSpeakerFirstText().replace(/</g, '&lt;')}</pre>`); printWindow.document.close(); printWindow.print(); return; } const builders = { txt: [buildSpeakerFirstText(), 'verbatim-transcript.txt', 'text/plain'], srt: [buildSrt(), 'verbatim-transcript.srt', 'text/plain'], vtt: [buildVtt(), 'verbatim-transcript.vtt', 'text/vtt'], json: [buildJson(), 'verbatim-transcript.json', 'application/json'], word: [`<html><body><pre>${buildSpeakerFirstText().replace(/</g, '&lt;')}</pre></body></html>`, 'verbatim-transcript.doc', 'application/msword'] }; const [content, name, type] = builders[format]; download(content, name, type); setStatus(`${format.toUpperCase()} export downloaded.`); }));
$('copySession').addEventListener('click', copySession);
document.addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('searchBar').classList.remove('hidden'); $('searchInput').focus(); } if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); } }); $('helpButton').addEventListener('click', () => setStatus('Edit speakers and text directly. Timestamp starts stay continuous by design.'));
loadSample();