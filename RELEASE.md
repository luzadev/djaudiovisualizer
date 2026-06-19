# Installazione su Mac — DJ Visualizer

L'app è distribuita come **DMG non firmato con un certificato Apple** (non c'è
un account sviluppatore a pagamento). È **ad-hoc firmata**, quindi funziona, ma
al primo avvio macOS la blocca per sicurezza (Gatekeeper). Ecco come installarla
e sbloccarla.

## 1. Installare

1. Apri il file **`DJ Visualizer-1.0.0-arm64.dmg`**.
2. Trascina **DJ Visualizer** nella cartella **Applicazioni**.

## 2. Sbloccare la sicurezza (Gatekeeper)

Al primo avvio può comparire *«DJ Visualizer non può essere aperto perché Apple
non può verificare…»* oppure *«…è danneggiata e non può essere aperta»*.
Scegli **uno** di questi metodi.

### Metodo A — Apri col tasto destro (il più semplice)
1. In **Applicazioni**, **clic destro** (o Ctrl+clic) su **DJ Visualizer**.
2. Scegli **Apri**.
3. Nella finestra che appare, premi di nuovo **Apri**.

Da quel momento si apre normalmente con un doppio clic.

### Metodo B — Da Impostazioni di Sistema
1. Prova ad aprire l'app (verrà bloccata).
2. Vai in **Impostazioni di Sistema ▸ Privacy e Sicurezza**.
3. In fondo, accanto a *«DJ Visualizer è stata bloccata…»*, premi **Apri comunque**.

### Metodo C — Terminale (se compare "è danneggiata")
Questo errore appare quando il file è stato scaricato (attributo "quarantena").
Apri il **Terminale** e incolla:

```bash
xattr -cr "/Applications/DJ Visualizer.app"
```

Poi apri l'app normalmente. In alternativa è incluso lo script
**`scripts/fix-security.command`**: doppio clic per eseguirlo.

> Nota: questi passaggi servono **solo la prima volta**. Sono necessari perché
> l'app non è notarizzata da Apple (serve un Apple Developer Program a pagamento).

## 3. Permessi richiesti dall'app

- **Microfono / Ingresso audio** — per l'input live e per catturare l'audio di
  sistema (BlackHole). macOS lo chiede al primo uso; concedilo.
- **Registrazione schermo** — *non* richiesta: l'app registra il proprio canvas,
  non lo schermo.

## Ricompilare il DMG

```bash
npm install
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist
```
Il DMG viene creato in `dist/`.
