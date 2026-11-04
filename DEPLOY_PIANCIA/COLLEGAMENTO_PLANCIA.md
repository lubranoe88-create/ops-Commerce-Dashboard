# Far parlare la plancia col modello locale

## 1) Cosa serve (solo 3 cose)
1. Il PC Windows acceso, con il modello già avviato (`start-llama-server.bat`).
2. La plancia che gira sullo **stesso PC**.
3. Un editor di testo per cambiare **una riga** nel file `openrouter.js`.

## 2) Comandi (copia e incolla uno alla volta)
1. Avvia il modello: doppio clic su `start-llama-server.bat` e attendi che finisca di caricare.
2. Apri `openrouter.js` (nella cartella `backend` della plancia).
3. Trova la riga con `openrouter.ai` e sostituiscila con:
   `http://127.0.0.1:8080/v1/chat/completions`
4. Salva il file.
5. Riavvia la plancia (chiudi e riapri il server della dashboard).

## 3) Come verificare
1. Nella plancia, manda un messaggio breve: «Ciao».
2. Se risponde Atlas in italiano → collegamento ok.
3. (Opzionale) Nel terminale del modello vedi attività mentre parli.

## 4) Se non va
1. Controlla che `start-llama-server.bat` sia ancora aperto e senza errori.
2. Controlla di aver salvato `openrouter.js` e riavviato la plancia.
3. Riprova «Ciao». Se ancora no: spegni tutto, riavvia prima il modello, poi la plancia.
