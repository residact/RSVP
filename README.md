# RSVP · Lecteur

Lecteur RSVP auto-hébergé : lis les réponses de Claude un mot à la fois, sur PC et sur téléphone.
Une seule image Docker contient l'interface web, l'API REST et un serveur MCP.

## Lancer

```bash
docker compose up -d --build
docker compose logs rsvp      # affiche le jeton d'accès
```

Ouvre http://localhost:8787 et saisis le jeton (ou ouvre `http://localhost:8787/?token=<jeton>`).
Les textes et réglages sont dans le volume `rsvp-data`.

Variables : `RSVP_TOKEN` (jeton fixe), `RSVP_PUBLIC_URL` (adresse https publique), `PORT`.

## Pages

| Page | Rôle |
|---|---|
| Lecteur | lecture RSVP, curseur de vitesse, scrub, texte complet cliquable |
| Livres | bibliothèque de livres (EPUB, PDF, MOBI/AZW3, TXT, Markdown) : import par glisser-déposer, couvertures, chapitres, reprise exacte de la lecture |
| Coller | coller un texte (markdown accepté), bibliothèque des textes reçus |
| Config | vitesses, options, URL du MCP, jeton, exemples d'API |

Raccourcis du lecteur : `Espace` lecture/pause · `←` `→` mot · `↑` `↓` vitesse · `T` texte · `R` début.

## Connecter Claude (MCP)

1. Expose le port 8787 en https (Tailscale Funnel, Cloudflare Tunnel, reverse proxy) et renseigne `RSVP_PUBLIC_URL`.
2. Dans Claude : Paramètres → Connecteurs → Ajouter un connecteur personnalisé.
   URL : `https://<ton-domaine>/mcp` ; en-tête `Authorization: Bearer <jeton>`
   (ou, si l'interface ne propose pas d'en-tête : `https://<ton-domaine>/mcp?token=<jeton>`).
3. Dis « lis ça en RSVP » : Claude appelle `rsvp_send` et le lecteur s'ouvre sur tes appareils.

Outils : `rsvp_send`, `rsvp_list`, `rsvp_get`, `rsvp_set_speed`, `rsvp_delete`.

## API REST

```bash
curl -X POST http://localhost:8787/api/texts \
  -H "Authorization: Bearer <jeton>" -H "Content-Type: application/json" \
  -d '{"title":"Test","text":"Bonjour le monde"}'
```

`GET/POST/DELETE /api/texts`, `GET /api/texts/latest`, `GET/DELETE /api/texts/:id`,
`GET/POST /api/books` (fichier brut dans le corps, `?name=livre.pdf`), `GET/DELETE /api/books/:id`, `GET /api/books/:id/chapters/:n`, `PUT /api/books/:id/progress`, `GET/PUT /api/settings`, `GET /api/events` (SSE), `POST /api/token/regenerate`.

## Sécurité

Le jeton protège l'API, le flux et le MCP. Ne publie pas le port sans https.

## Formats de livres

EPUB (chapitres, couverture, table des matières), PDF (texte extractible ; chapitres d'après les signets, sinon parties d'environ 2 500 mots ; en-têtes et numéros de page retirés), MOBI / AZW / AZW3 sans DRM, TXT et Markdown. Les PDF numérisés (images) et les fichiers à DRM ne sont pas lisibles.
