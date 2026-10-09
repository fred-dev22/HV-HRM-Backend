# Déploiement chez un client

Procédure pour les installations où **nous n'avons aucun accès au serveur** :
le client déploie lui-même, nous fournissons des scripts SQL et un bundle.

Le backend y tourne en bundle autonome (`npm run build:iis`, via `ncc`) : il
n'y a **ni `node_modules` ni CLI Prisma** sur le serveur. `prisma db push`,
`prisma migrate` et `prisma db seed` n'y sont donc pas exécutables — d'où les
scripts SQL de ce dossier.

## Marque, modules et organisation du code

**Un seul dépôt.** L'application est la même pour tous les clients : sans
configuration, c'est « HRM », sans logo, aux couleurs neutres, avec le seul
socle (absences). Tout ce qui est propre à un client vit dans le dossier
`brand/` du serveur (un `client.json` et le logo), jamais dans le code ni dans le
`.env`, qui ne garde que l'infrastructure et les secrets. Le nom du produit
« Productive 247 HRM » (barre du haut, à propos, emails) reste en dur.

```
brand/
  client.json   nom, couleurs, modules, contact (aucun secret)
  logo.png      le logo du client (facultatif)
```

```json
{
  "name": "HV", "short": "HV",
  "color": "#ef463b", "accent": "#7a1f1f",
  "background": "#fdeae8", "tint": "#fdeae8",
  "logo": "logo.png",
  "modules": ["recruitment", "training"]
}
```

Le serveur relit `client.json` dès qu'il change : modifier une couleur ou un module
ne demande **aucun redémarrage**, le frontend suit au rechargement de la page. Sans
dossier `brand/`, c'est l'application générique.

Appliquer le profil d'un client sur une instance (copie `deploy/<client>/brand/`
vers `brand/`, ne touche ni la base, ni le code, ni le `.env`) :

```bash
npm run client:hv       # profil HV : deploy/hv/brand
npm run client:reset    # retour à l'application générique
```

Seuls `name`, `color` et `accent` comptent vraiment ; `background` (fond des pages)
et `tint` (en-têtes de tableau, lignes sélectionnées, champs) sont gris neutre
tant qu'ils ne sont pas renseignés. Les autres teintes sont dérivées des deux
couleurs principales. Modules : `missions_expenses`, `recruitment`, `training`,
`payroll`, `reports` ; le socle est toujours actif.

**Branches.**

- `main` / `qa` : le produit générique. Toute amélioration utile à tous les
  clients se fait ici.
- `client/<nom>` : une branche par client, créée depuis `main`, qui ne porte que
  ce qui lui est propre (demande spécifique, profil `deploy/<nom>/`).
- Une évolution générique se fait sur `qa`/`main`, puis se **merge dans chaque
  branche client** (`git checkout client/hv && git merge main`). Une demande
  spécifique se fait uniquement sur la branche du client concerné.

## Nouveau client : un seul script

Pour préparer un nouveau client, on renseigne la marque et les modules, le script
génère le reste :

```bash
npm run client:new -- --name "Acme Corp" --short Acme --color "#0057B8"   --logo C:\logoscme.png --modules recruitment,training   --admin-email admin@acme.com --domain rh.acme.com
```

Il génère `deploy/<client>/` : le dossier `brand/` (client.json + logo, à copier à
côté du `.env` du serveur), `.env.generated` (secrets inclus, non versionné),
`ADMIN-CREDENTIALS.txt`, `install.json` (choix d'installation), les scripts SQL avec
`--with-sql`, et une `INSTALLATION.md` pré-remplie. Après installation :
`npm run client:check -- https://rh.acme.com` vérifie la marque et les verrous de
modules (module coupé = 404). Activer ou couper un module plus tard : modifier la
liste `modules` de `brand/client.json`, sans redémarrer.

## Nouveau client : deux scripts SQL, pas plus

Un client qui s'installe pour la première fois ne reçoit **que deux scripts**, à
exécuter dans l'ordre sur une base vide :

1. `01-schema.sql` : la structure complète de la base (générée depuis `prisma/schema.prisma`) ;
2. `02-seed.sql` : les données d'amorçage (permissions, catégories, entité racine,
   compte administrateur, type de frais système), générées depuis `prisma/seed-data.ts`.

Il n'y a jamais de script de mise à jour à lui passer. Les deux fichiers se
régénèrent à chaque livraison (`npm run client:new -- ... --with-sql`), donc tout
changement de schéma ou de données d'amorçage doit être fait dans
`schema.prisma` / `seed-data.ts` : il se retrouve alors tout seul dans les deux
scripts. Les scripts `NN-update.sql` (par exemple `v1.1.0/03-update.sql`) ne servent
qu'aux clients **déjà installés**, pour les faire passer de leur version à la suivante.

Avant chaque livraison :

```bash
npm run delivery:check
```

Il régénère les deux scripts dans un dossier temporaire et échoue si une table,
une colonne, une permission ou une catégorie du code manque dans l'un des deux.

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

Identifiants du compte créé par `02-seed.sql` : ceux de `ADMIN-CREDENTIALS.txt`
(`admin@hv.com` / `Admin@2026!` si le seed est généré sans options), avec changement de mot de passe imposé à la première connexion.

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
