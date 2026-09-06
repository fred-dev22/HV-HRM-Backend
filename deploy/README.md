# Déploiement chez un client

Procédure pour les installations où **nous n'avons aucun accès au serveur** :
le client déploie lui-même, nous fournissons des scripts SQL et un bundle.

Le backend y tourne en bundle autonome (`npm run build:iis`, via `ncc`) : il
n'y a **ni `node_modules` ni CLI Prisma** sur le serveur. `prisma db push`,
`prisma migrate` et `prisma db seed` n'y sont donc pas exécutables — d'où les
scripts SQL de ce dossier.

## Contenu

```
deploy/hv/v1.0.0/01-schema.sql   structure (30 tables) — 1 seule fois
deploy/hv/v1.0.0/02-seed.sql     données d'amorçage    — 1 seule fois
prisma/deployed/hv.prisma        capture du schéma déployé (référence)
```

Un sous-dossier par client et par version. Les scripts envoyés sont conservés
ici : c'est notre seule trace de ce que contient réellement leur base.

## Installation initiale

Ce que le client doit préparer :

1. Une base SQL Server **vide**, créée par eux (collation à leur convenance).
2. Un login SQL avec `db_owner` sur cette base — les scripts font du DDL.
3. Node.js ≥ 20 sur le serveur, et le mode d'hébergement (IIS + iisnode, ou
   service Windows / reverse proxy vers `node index.js`).

Ce qu'on leur envoie :

1. `01-schema.sql`, puis `02-seed.sql` — dans cet ordre, sur la base vide.
   Chacun est transactionnel : il passe entièrement ou ne laisse rien.
2. Le contenu de `dist/standalone/` (~30 Mo) produit par `npm run build:iis`.
3. Le modèle `.env.example`, qu'ils remplissent **sur le serveur** : le `.env`
   n'est pas versionné et n'est pas dans le bundle.

Identifiants du compte créé par `02-seed.sql` : `admin@hv.com` /
`Admin@2026!`, avec changement de mot de passe imposé à la première connexion.

### Points sur lesquels un déploiement échoue en pratique

- **Le `.env` doit être dans le répertoire de travail du processus**, pas à
  côté de `index.js` : `dotenv` le cherche dans le `cwd`.
- **Si SQL Server est injoignable au démarrage, le processus s'arrête**
  immédiatement (le `$connect()` de `onModuleInit` remonte). Démarrer l'API
  après la base, et prévoir une politique de redémarrage.
- **`CORS_ORIGIN` non renseignée** ⇒ seul `http://localhost:5173` est accepté
  et le frontend de production est bloqué par le navigateur.
- **`build:iis` ne tourne que sous Windows** (il utilise `copy` et `xcopy`).
- **`QUOTED_IDENTIFIER`** : `Employee.UserId` porte un index *filtré*. SQL
  Server exige `SET QUOTED_IDENTIFIER ON` pour le créer **et pour écrire dans
  la table**. Les scripts livrés portent l'option en en-tête, mais un DBA qui
  fait du DML manuel sur `Employee` via `sqlcmd` doit passer `-I`. SSMS et les
  pilotes applicatifs (dont celui de l'app) l'activent par défaut.

## Mises à jour

Nous n'avons pas accès à la base : `migrate diff` ne peut donc pas lire son
schéma. La référence est le fichier `prisma/deployed/<client>.prisma`, miroir
de ce que le client a réellement en base.

```bash
npx ts-node prisma/export-schema-sql.ts deploy/hv/v1.1.0/03-update.sql --from prisma/deployed/hv.prisma
```

Puis, **une fois seulement que le client a confirmé l'application** du script :

```bash
cp prisma/schema.prisma prisma/deployed/hv.prisma
```

Mettre à jour la capture avant confirmation fait perdre le point de référence :
les diffs suivants sauteraient les modifications non appliquées et le script
casserait chez le client. C'est le seul vrai risque du dispositif.

Avant chaque envoi :

- **Relire le SQL généré.** Un renommage de champ se traduit par
  `DROP COLUMN` + `ADD COLUMN`, donc une perte de données silencieuse. Ces
  cas se corrigent à la main (`sp_rename`).
- **Les migrations de données ne sont pas couvertes.** `migrate diff` ne
  produit que du DDL ; les backfills (voir `prisma/backfill-*.ts`) doivent être
  traduits en SQL et livrés dans le même dossier de version.
- **Une permission ajoutée au catalogue** arrive en base via le seed, mais
  n'est attribuée à aucun compte existant (voir `prisma/seed.ts`) : prévoir
  l'`INSERT` dans `UserPermission` si elle doit l'être immédiatement.

## Régénérer les scripts

```bash
npx ts-node prisma/export-schema-sql.ts deploy/hv/v1.0.0/01-schema.sql
```

```bash
npx ts-node prisma/export-seed-sql.ts deploy/hv/v1.0.0/02-seed.sql
```

Les deux scripts lisent la même source que le seed TypeScript
(`prisma/seed-data.ts`), pour que ce qui tourne chez nous et ce qu'on envoie
chez eux ne divergent pas. Passer par ces scripts plutôt que par le CLI Prisma
directement : ils ajoutent l'en-tête de session et le correctif d'index filtré,
et évitent que la sortie du CLI (« Loaded Prisma config », encart de mise à
jour npm) ne finisse dans le fichier `.sql`.

Les scripts livrés ont été validés en exécution réelle sur une base SQL Server
jetable : 30 tables, 36 permissions, 4 catégories, 70 associations, compte
admin rattaché à « Directeur RH » avec ses 36 permissions, contraintes FK
toutes revalidées, accents préservés, création de plusieurs employés sans
compte utilisateur, et rejeu du seed correctement refusé.
