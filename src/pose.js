// Body tracking for the interactive families: MediaPipe PoseLandmarker
// (BlazePose lite), fully offline — the WASM runtime and the model are
// bundled with the app and served over the djvres:// protocol (fetch does
// not work on file:// URLs). Exposes window.PoseTracker; interactive.js uses
// it when available and silently falls back to plain motion detection when
// it is not (e.g. missing files).
(function () {

class PoseTracker {
  static async create() {
    const V = window.Vision;
    if (!V || !V.PoseLandmarker) throw new Error('runtime MediaPipe non caricato');
    const files = await V.FilesetResolver.forVisionTasks('djvres://mp/wasm');
    const lm = await V.PoseLandmarker.createFromOptions(files, {
      baseOptions: {
        modelAssetPath: 'djvres://models/pose_landmarker_lite.task',
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      numPoses: 1
    });
    const t = new PoseTracker();
    t.lm = lm;
    return t;
  }

  // Returns the 33 normalized landmarks of the first person, or null.
  detect(video, tsMs) {
    const res = this.lm.detectForVideo(video, tsMs);
    return (res && res.landmarks && res.landmarks[0]) || null;
  }

  close() { try { this.lm.close(); } catch (e) { /* ignore */ } }
}

window.PoseTracker = PoseTracker;

})();
