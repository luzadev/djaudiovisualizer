# DJ Visualizer

> di **Dj LuZa** · info@djluza.com

App desktop (Electron) per Mac che mostra **frattali e visual astratti reattivi all'audio** su uno schermo esterno. L'audio può arrivare da un **file caricato** (con **playlist** riordinabile e tasti rapidi), da un **input live** (microfono / line-in) o dall'**audio di sistema** (il tuo set DJ) tramite un device virtuale tipo BlackHole. Puoi sovrapporre **immagini** e **scritte scorrevoli**.

Include un **motore di effetti parametrico**: 16 famiglie di shader × palette di colori × varianti di stile generano **oltre 1500 preset**, con una **sequenza di effetti** (playlist) ad auto-cambio a tempo o sul beat.

## Due finestre

All'avvio si aprono **due finestre**:

- **Controlli** — il pannello con tutte le funzioni (sorgente audio, scene, slider, immagini, testo, scelta monitor). Sta sul tuo schermo principale.
- **Output** — solo la visualizzazione, senza interfaccia. Va automaticamente a schermo intero sul monitor esterno se presente.

Comandi e tasti agiscono sul pannello Controlli e si riflettono sull'Output. Chiudendo la finestra Controlli si chiude tutta l'app.

## Avvio

```bash
npm install      # solo la prima volta
npm start
```

## Controlli rapidi (tastiera)

| Tasto | Azione |
|-------|--------|
| `1`–`9` | Applica i primi 9 effetti della sequenza |
| `F` | Schermo intero output |
| `O` | Aggiungi brani alla playlist |
| `G` | Carica immagini |
| `T` | Mostra/nascondi testo scorrevole |
| `← →` | Cambia immagine |
| `Spazio` | Play/pausa del brano |
| tasti personalizzati | Avvio rapido di brani e effetti (assegnabili dal pannello con ⌨) |

Puoi anche **trascinare** brani (mp3/wav) o immagini direttamente sul pannello.

## Effetti

- **Libreria effetti**: oltre 1500 preset filtrabili per famiglia e ricercabili per nome. Clic per applicarli all'istante.
- **Sequenza effetti**: aggiungi i preset preferiti (➕), riordinali col drag, assegna tasti rapidi, e attiva **Auto-cambio** (a intervallo) o **Sul beat** (cambia a ritmo), con **Shuffle**.
- **Equalizzatore visual**: regola quanto Bassi/Medi/Alti influenzano la grafica.

## Playlist audio

Carica più brani, riordinali col drag della maniglia ⠿, assegna un tasto rapido a ciascuno (⌨), avvia/pausa per brano (▶/⏸) e attiva **Ripeti** per l'avanzamento automatico a fine traccia.

## Schermo esterno

Nel pannello, sezione **Schermo**: scegli il monitor (di default seleziona quello esterno) e premi **Vai** → la finestra si sposta e va a schermo intero su quel display. `F` per uscire.

## Sorgenti audio

- **File**: pulsante 📂 o trascina il file. L'audio si sente dalle casse del Mac.
- **Input live (mic / line-in)**: seleziona il device dal menu e premi *Usa input*. Utile con una scheda audio/mixer collegato all'ingresso.
- **Audio di sistema (il tuo set)**: serve un device virtuale, vedi sotto.

### Catturare l'audio di sistema con BlackHole

macOS non permette di catturare direttamente l'audio in uscita. Soluzione gratuita: **BlackHole**.

1. Installa BlackHole (2ch):
   ```bash
   brew install blackhole-2ch
   ```
   (oppure scaricalo da https://existential.audio/blackhole/)

2. Per **sentire l'audio E inviarlo al visualizer** allo stesso tempo, crea un **Multi-Output Device** in *Audio MIDI Setup* (Configurazione MIDI Audio):
   - `+` in basso a sinistra → **Create Multi-Output Device**
   - spunta sia le tue **casse/cuffie** sia **BlackHole 2ch**
   - imposta questo Multi-Output come uscita del Mac (o del software DJ)

3. In DJ Visualizer scegli **BlackHole 2ch** come input live e premi *Usa input*.

> In alternativa, manda direttamente l'uscita del software DJ a BlackHole se preferisci non sentire nulla dalle casse del Mac.

## Personalizzare i visual

Le scene sono shader GLSL in `src/shaders.js` (array `SHADERS.scenes`). Ognuna riceve uniform audio: `uBass`, `uMid`, `uTreble`, `uLevel`, `uBeat`, più `uTime` e `uRes`. Aggiungere una scena = aggiungere uno shader all'array e un bottone in `index.html`.

## Build di un .app/.dmg

```bash
npm run dist
```
Genera un `.dmg` in `dist/` (richiede electron-builder, già incluso).
