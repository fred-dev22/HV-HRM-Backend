# Installation de Congélo

Fichier genere par `scripts/new-client.mjs` le 2026-11-07. Version livree : 1.0.0.

| Reglage | Valeur |
| --- | --- |
| Nom affiche | Congélo (court : Congélo) |
| Couleur principale | #006b3c |
| Logo | fourni (brand/) |
| Modules actifs | time |
| Adresse publique | <adresse publique de l'application> |
| Compte administrateur | admin@galana.mg |

## 1. Ce que le client doit preparer

1. Une base SQL Server **vide**, et un login SQL `db_owner` sur cette base.
2. Node.js 20 ou plus sur le serveur, et un mode d'hebergement (IIS + iisnode, ou service Windows derriere un reverse proxy).
3. Une adresse publique avec certificat HTTPS, qui sert le frontend et transmet `/api` au backend.
4. Pour les emails : une application Microsoft Entra (Azure AD) avec la permission `Mail.Send` et une boite d'envoi. Pour les pieces jointes : `Sites.ReadWrite.All` et un site SharePoint (facultatif).

## 2. Base de donnees

Sur la base vide, dans cet ordre (chaque script est transactionnel) :

1. `v1.0.0/01-schema.sql`
2. `v1.0.0/02-seed.sql`

Le compte administrateur est cree avec le mot de passe de `ADMIN-CREDENTIALS.txt`, a changer obligatoirement a la premiere connexion.

## 3. Backend

1. Sur un poste de build Windows (une seule fois, le meme paquet sert tous les clients) : `npm run build:iis` produit `dist/standalone/`.
2. Copier `dist/standalone/` sur le serveur.
3. Copier `deploy/grt/.env.generated` sur le serveur sous le nom `.env`, dans le repertoire de travail du processus, et le dossier `deploy/grt/brand/` (client.json + logo) a cote.
4. Renseigner dans `.env` : `DATABASE_URL`, les blocs `GRAPH_MAIL_*` et, si utilise, `GRAPH_SHAREPOINT_*`.
5. Demarrer le backend (apres la base de donnees).

## 4. Frontend

1. Une seule construction pour tous les clients : `VITE_API_URL=/api npm run build` (adresse relative : le frontend appelle l'API sur son propre domaine).
2. Servir `dist/` sur <adresse publique de l'application> et transmettre `/api` (et `/socket.io`) au backend.
3. La marque, les couleurs, le logo et les modules viennent du backend (`GET /api/config/public`) : **aucune reconstruction** pour changer de client ou de modules.

## 5. Verifier

```bash
node scripts/check-instance.mjs <adresse publique de l'application>
```

Le script affiche la marque et les modules lus sur l'instance, puis controle que chaque module coupe repond bien 404 et que chaque module actif repond 401 (route protegee). Puis, a la main :

1. Ouvrir <adresse publique de l'application> : le nom, le logo et la couleur sont ceux de Congélo.
2. Se connecter avec le compte administrateur et changer le mot de passe.
3. Creer un employe avec un compte : l'email d'accueil doit arriver, au nom de Congélo.

## 6. Activer ou couper un module plus tard

Modifier la liste `modules` de `brand/client.json` (valeurs : missions_expenses, recruitment, training, deadlines, time, payroll, reports). Pas de redemarrage : le serveur relit le fichier des qu'il change, le frontend suit au prochain chargement, et les routes du module coupe repondent 404.

## 7. Changer la marque plus tard

Modifier `brand/client.json` (nom, couleurs, logo) et remplacer le fichier du logo. Meme principe : aucun redemarrage, aucune reconstruction du frontend. Le `.env` ne contient ni marque ni module.

> Le mot de passe temporaire de l'administrateur a ete genere. Il est dans `ADMIN-CREDENTIALS.txt`, a communiquer par un canal sur puis a supprimer.
