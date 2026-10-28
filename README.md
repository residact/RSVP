# RSVP · Lecteur

Lecteur RSVP auto-hébergé : lis les réponses de Claude (ou tes livres) un mot à la fois, sur PC et sur téléphone.
Une seule image Docker contient l'interface web, l'API REST, un serveur MCP et la bibliothèque de livres.

**Stack** : [Bun](https://bun.sh) · TypeScript (strict) · `Bun.serve` · SDK MCP · interface en TypeScript sans framework,
bundlée par Bun.

## Lancer

```bash
cp .env.example .env        # puis renseigne RSVP_TOKEN (ex. : openssl rand -base64 24 | tr '+/' '-_' | tr -d '=')
bun run docker:up          # = docker compose -f docker/docker-compose.yml --env-file .env up -d --build
```

Ouvre http://localhost:8787 et saisis le jeton (ou `http://localhost:8787/?token=<jeton>`).
Les textes, livres et réglages sont dans le volume Docker `rsvp-data`.

### Fichier `.env`

| Variable | Rôle |
|---|---|
| `RSVP_TOKEN` | jeton d'accès à l'interface, à l'API et au MCP (généré et affiché dans les logs si vide) |
| `RSVP_PUBLIC_URL` | adresse https publique si tu exposes le port (tunnel) : sert aux liens du MCP |
| `PORT` | port publié sur la machine hôte (8787 par défaut) |

`.env` est ignoré par git ; `.env.example` sert de modèle.

## Podman

Le même `docker/Dockerfile` et le même `docker/docker-compose.yml` fonctionnent avec Podman (rootless).

```bash
podman-compose -f docker/docker-compose.yml --env-file .env up -d --build
podman-compose -f docker/docker-compose.yml logs rsvp
```

Sans compose :

```bash
podman build --format docker -f docker/Dockerfile -t localhost/rsvp-reader:latest .
podman run -d --name rsvp --restart unless-stopped --env-file .env \
  -e PORT=8787 -e DATA_DIR=/data -p 8787:8787 -v rsvp-data:/data localhost/rsvp-reader:latest
```

### Service systemd (Quadlet)

Pour un démarrage automatique géré par systemd (utilisateur), sans démon :

```bash
bun podman/install.ts --dry-run     # voir les unités générées
bun podman/install.ts               # écrit ~/.config/containers/systemd/, construit l'image et démarre rsvp.service
loginctl enable-linger $USER        # (facultatif) démarrer sans session ouverte
```

Les unités sont dans [podman/](podman) : `rsvp.build` (image), `rsvp-data.volume` (données) et `rsvp.container`
(service, port lu dans `PORT` du `.env`). `bun podman/install.ts --uninstall` les retire (le volume est conservé).
Ne lance pas Docker et Podman sur le même port en même temps.

## Développement

```bash
bun install
bun run dev          # construit l'interface puis lance le serveur avec rechargement
bun run typecheck    # tsc --noEmit
bun test             # tests (store, formats de livres, markdown, installation du skill et de Quadlet)
```

Sans Bun installé, utilise l'image officielle : `docker run --rm -v "$PWD":/app -w /app oven/bun:1 bun test`.

```
src/server/   serveur Bun (API REST, SSE, MCP, parseurs EPUB/PDF/MOBI)
src/web/      interface (TypeScript, CSS)
src/shared/   types partagés serveur / interface
docker/       Dockerfile, docker-compose.yml, exclusions de build
skills/       skill d'agent + script d'installation
podman/       unités Quadlet (systemd) + installateur
test/         tests bun
```

## Pages

| Page | Rôle |
|---|---|
| Lecteur | lecture RSVP, curseur de vitesse, scrub, texte complet cliquable |
| Livres | bibliothèque (EPUB, PDF, MOBI/AZW3, TXT, Markdown), couvertures, chapitres, reprise exacte de la lecture |
| Coller | coller un texte (markdown accepté), bibliothèque des textes reçus |
| Config | vitesses, options, URL du MCP, jeton, exemples d'API |

Raccourcis du lecteur : `Espace` lecture/pause · `←` `→` mot · `↑` `↓` vitesse · `T` texte · `R` début.

## Connecter Claude (MCP)

1. Expose le port 8787 en https (Tailscale Funnel, Cloudflare Tunnel, reverse proxy) et renseigne `RSVP_PUBLIC_URL`.
2. Dans Claude : Paramètres → Connecteurs → Ajouter un connecteur personnalisé.
   URL : `https://<ton-domaine>/mcp` ; en-tête `Authorization: Bearer <jeton>`
   (ou, si l'interface ne propose pas d'en-tête : `https://<ton-domaine>/mcp?token=<jeton>`).
3. Dis « lis ça en RSVP » : Claude appelle `rsvp_send` et le lecteur s'ouvre sur tes appareils.

Outils : `rsvp_send`, `rsvp_list`, `rsvp_get`, `rsvp_set_speed`, `rsvp_delete`, `rsvp_books`.

## Skill pour les agents de code

Le dossier [skills/rsvp-reader](skills/rsvp-reader) est un skill (format Agent Skills) qui apprend à un agent à
envoyer un texte au lecteur (outil MCP `rsvp_send`, ou script `send.ts`). Installation globale :

```bash
bun skills/install.ts --dry-run    # voir ce qui sera fait
bun skills/install.ts              # installe partout
```

| Cible | Dossier | Agents concernés |
|---|---|---|
| `claude` | `~/.claude/skills` | Claude Code, Claude dans VS Code |
| `pi` | `~/.pi/agent/skills` | pi.dev |
| `copilot` | `~/.copilot/skills` | GitHub Copilot dans VS Code |

Options : `--target claude,pi` · `--link` (lien symbolique, mises à jour automatiques) · `--force` ·
`--uninstall [--purge]` · `--url` / `--token` (sinon lus dans `.env`). L'installation écrit aussi
`~/.config/rsvp-reader/config.json` (URL + jeton, droits 600) que le script d'envoi utilise.
Recharge l'agent ensuite (pi : `/reload`).

## API REST

```bash
curl -X POST http://localhost:8787/api/texts \
  -H "Authorization: Bearer <jeton>" -H "Content-Type: application/json" \
  -d '{"title":"Test","text":"Bonjour le monde"}'
```

`GET/POST/DELETE /api/texts`, `GET /api/texts/latest`, `GET/DELETE /api/texts/:id`,
`GET/POST /api/books` (fichier brut dans le corps, `?name=livre.pdf`), `GET/DELETE /api/books/:id`,
`GET /api/books/:id/chapters/:n`, `PUT /api/books/:id/progress`, `GET/PUT /api/settings`,
`GET /api/events` (SSE), `POST /api/token/regenerate`, `POST /mcp`.

## Formats de livres

EPUB (chapitres, couverture, table des matières), PDF (texte extractible ; chapitres d'après les signets, sinon parties
d'environ 2 500 mots ; en-têtes et numéros de page retirés), MOBI / AZW / AZW3 sans DRM, TXT et Markdown.
Les PDF numérisés (images) et les fichiers à DRM ne sont pas lisibles.

## Sécurité

Le jeton protège l'API, le flux et le MCP. Ne publie pas le port sans https.
