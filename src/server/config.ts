// Configuration lue dans l'environnement (Bun charge automatiquement le fichier .env).
import path from "node:path";

const env = Bun.env;

export const config = {
  port: Number(env.PORT ?? 8787),
  /** Adresse d'écoute explicite ; sinon double pile ("::") avec repli sur IPv4. */
  hosts: env.HOST ? [env.HOST] : ["::", "0.0.0.0"],
  dataDir: env.DATA_DIR ?? "./data",
  token: env.RSVP_TOKEN?.trim() || undefined,
  publicUrl: env.RSVP_PUBLIC_URL?.trim().replace(/\/$/, "") || undefined,
  webDir: env.WEB_DIR ?? path.join(import.meta.dir, "../../dist/web"),
  maxBody: 2 * 1024 * 1024,
  maxUpload: 100 * 1024 * 1024,
} as const;
