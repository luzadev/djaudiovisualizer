# DJ Visualizer

> di **Dj LuZa** · info@djluza.com

App desktop (Electron) per **Mac** che proietta su uno **schermo esterno** dei visual
**reattivi all'audio** — frattali, astratti, silhouette, VU-meter, waveform e altro —
con playlist audio/video, scene a tempo, overlay grafici, testo scorrevole e
**registrazione MP4**. Pensata per DJ e VJ.

L'audio può arrivare da **file**, da un **input live** (mic / line-in) o
dall'**audio di sistema** (il tuo set) tramite un device virtuale tipo BlackHole.

---

## Indice

- [Avvio](#avvio)
- [Architettura a due finestre](#architettura-a-due-finestre)
- [Le schede del pannello](#le-schede-del-pannello)
  - [🎵 Audio](#-audio)
  - [🌀 Effetti](#-effetti)
  - [🎹 Pad](#-pad)
  - [🖼 Immagini](#-immagini)
  - [🔤 Testo](#-testo)
  - [🔴 Registra](#-registra)
  - [🖥 Schermo](#-schermo)
- [Scorciatoie da tastiera](#scorciatoie-da-tastiera)
- [Audio di sistema con BlackHole](#audio-di-sistema-con-blackhole)
- [Installazione del DMG](#installazione-del-dmg)
- [Sviluppo](#sviluppo)

---

## Avvio

```bash
npm install      # solo la prima volta
npm start
```

## Architettura a due finestre

All'avvio si aprono **due finestre**:

- **Controlli** — il pannello con tutte le funzioni, sul tuo schermo principale.
- **Output** — solo la visualizzazione, senza interfaccia, a schermo intero sul
  monitor esterno (se presente).

Comandi e tasti agiscono sul pannello e si riflettono in tempo reale sull'output.
Chiudendo la finestra Controlli si chiude l'app.

---

## Le schede del pannello

### 🎵 Audio

- **Sorgenti**: riproduzione **file**, **input live** (mic/line/BlackHole) e
  **scelta del device di uscita** (casse/cuffie/scheda audio).
- **Playlist audio e video**:
  - Aggiungi **brani audio e video** (trascina o ➕). I video hanno l'icona 🎞 e
    vengono mostrati a schermo intero **col loro audio** (che alimenta anche
    spettro/waveform).
  - **Riordina** col drag (⠿), **tasto rapido** per brano (⌨), **▶/⏸** pausa,
    **clic sul nome** = avvia/riavvia dall'inizio, **Ripeti** per l'auto-avanzamento.
  - **Durata** e **tempo rimanente** con **barra di avanzamento** per ogni brano.
  - **🎬 Scene a tempo (cue)**: a ogni brano puoi associare una timeline di cue
    (`@mm:ss`) che cambiano automaticamente **effetto + testo + immagine** mentre
    il brano suona (es. `@00:00` intro, `@00:30` drop…).
  - **💾 Salva / 📂 Carica** la playlist su file, e **persistenza automatica** tra
    le sessioni.
- **Equalizzatore visual**: regola quanto **Bassi / Medi / Alti** influenzano la
  grafica. Più **Reattività** (master) e **Velocità**.
- **Livelli** BASS/MID/HIGH in tempo reale.
- **Resa video in playlist**: fusione (normale/screen/overlay…), opacità e
  adatta/riempie per i video riprodotti dalla lista.

### 🌀 Effetti

Motore di effetti **parametrico**: **29 famiglie** di shader × **17 palette** ×
**6 varianti** = **oltre 2900 preset**.

- **Libreria** filtrabile per famiglia e ricercabile per nome — clic per applicare.
  Cambiando il **filtro famiglia** si applica subito il primo preset di quella
  categoria.
- **Sequenza effetti**: metti in coda i preset preferiti (➕), riordina, assegna
  tasti rapidi, e attiva **Auto-cambio** (a intervallo) o **Sul beat**, con **Shuffle**.
  I tasti **1–9** lanciano i primi 9 della sequenza.
- **Effetti SVG / immagini**: scegli una sagoma dalla tendina (50+ SVG inclusi,
  pubblico dominio) o carica un tuo SVG/immagine → diventa un effetto reattivo
  (palette, simmetrie, warp).

**Categorie di effetti:**

| Categoria | Esempi |
|-----------|--------|
| Frattali / astratti | Julia, Mandelbrot, Plasma, Tunnel, Vortice, Caleidoscopi, Spirali… |
| Silhouette / persone | Ballerini (folla), Ballerino, Sagome (note musicali) |
| SVG / immagini | qualsiasi SVG/immagine come sorgente recolorabile |
| VU-Meter | barre di spettro, lancetta analogica, LED stereo |
| Waveform | forma d'onda del brano scorrevole + waveform radiale |
| Reattivi a banda | Bassi, Medi, Alti, Tri-Banda |

### 🎹 Pad

Un **launchpad 5×4** (20 pad): assegna un brano a ogni pad (clic o trascina),
premilo per avviarlo. Premendone un altro **ferma il corrente e parte il nuovo**.
- **Tasto rapido** per pad (⌨), **barra di avanzamento** sul pad attivo,
  **Crossfade** tra pad, **persistenza** automatica delle assegnazioni.

### 🖼 Immagini

- **Video (loop VJ)**: carica un video che va in loop (muto) e si **fonde** coi
  visual generati (opacità, modalità di fusione, adatta/riempie).
- **Immagini overlay**: slideshow ridimensionabile, durata, fusione, pulsazione
  sul beat.
- **2 loghi** indipendenti: posizione libera (X/Y), dimensione e opacità.

### 🔤 Testo

Testo scorrevole con:
- **Carattere**, **grandezza**, **grassetto**, **colore**.
- **Direzione**: orizzontale, **verticale su**, **verticale giù**.
- **Effetti movimento**: su e giù, **onda** (per lettera), zoom/pulse, flash, rotazione.
- Posizione (basso/alto/centro) e velocità.

### 🔴 Registra

Registra l'output (**visual + overlay + testo + audio**) in **MP4**:
- Formati: **16:9**, **9:16**, **1:1**, **4:3**, **3:4**, **21:9**.
- Salvataggio in *Filmati ▸ DJ Visualizer*. Richiede **ffmpeg** (di sistema).

### 🖥 Schermo

Scegli il **monitor di output** e premi *Manda al monitor* (fullscreen affidabile
anche con più schermi). `F` per attivare/disattivare lo schermo intero.

---

## Scorciatoie da tastiera

| Tasto | Azione |
|-------|--------|
| `1`–`9` | Applica i primi 9 effetti della sequenza |
| `F` | Schermo intero output |
| `O` | Aggiungi brani/video alla playlist |
| `G` | Carica immagini |
| `T` | Mostra/nascondi testo scorrevole |
| `← →` | Cambia immagine overlay |
| `Spazio` | Play/pausa del brano |
| tasti personalizzati | Avvio rapido di brani, effetti e pad (assegnabili con ⌨) |

Puoi anche **trascinare** brani, video o immagini direttamente sul pannello.

---

## Audio di sistema con BlackHole

macOS non permette di catturare direttamente l'audio in uscita. Soluzione gratuita:
**BlackHole**.

1. Installa BlackHole (2ch):
   ```bash
   brew install blackhole-2ch
   ```
   (oppure da https://existential.audio/blackhole/)
2. In *Configurazione MIDI Audio* crea un **Multi-Output Device** che includa sia le
   tue **casse/cuffie** sia **BlackHole 2ch**, e impostalo come uscita del Mac (o del
   software DJ) — così senti l'audio **e** lo mandi al visualizer.
3. In DJ Visualizer scegli **BlackHole 2ch** come input live e premi *Usa input*.

---

## Installazione del DMG

Le release contengono un **DMG non notarizzato** (nessun Apple Developer Program).
Vedi **[RELEASE.md](RELEASE.md)** per i dettagli; in breve:

1. Apri il DMG → trascina **DJ Visualizer** in **Applicazioni**.
2. Primo avvio: **clic destro ▸ Apri ▸ Apri**.
3. Se dice *«è danneggiata»*: `xattr -cr "/Applications/DJ Visualizer.app"`
   (o doppio clic su `scripts/fix-security.command`).

---

## Sviluppo

- **Stack**: Electron + WebGL2 (shader GLSL) + Web Audio API. Nessun framework UI.
- **File principali**:
  - `main.js` — finestre, IPC, gestione schermi, persistenza, registrazione (ffmpeg).
  - `src/output.*` — finestra di visualizzazione (canvas, overlay, audio engine).
  - `src/control.*` — pannello di controllo.
  - `src/shaders.js` — l'uber-shader parametrico (tutte le famiglie).
  - `src/effects.js` — generatore del catalogo (famiglie × palette × varianti).
  - `src/visualizer.js`, `src/audio.js` — motore grafico e analisi audio.
- **Compilare il DMG**:
  ```bash
  CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist
  ```
  Output in `dist/`.

Repo: https://github.com/luzadev/djaudiovisualizer
