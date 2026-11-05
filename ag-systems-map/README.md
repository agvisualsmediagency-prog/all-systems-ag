# AG Marketing — Company Systems Map

Every department, system and step AG runs: who owns it, how often it happens, each person's morning and close block, and a one-click prompt that puts the month's recurring tasks on the Notion General Calendar.

- **Frontend:** Vite (plain HTML + JavaScript), deployed on Vercel
- **Data:** Supabase (one table holds the whole map as JSON; edits sync live between teammates)
- **Login:** magic link by email; only emails on your team list can see or edit the map

---

## 1. Set up Supabase (about 5 minutes)

1. Go to [supabase.com](https://supabase.com) → **New project**. Name it `ag-systems-map`; any region near Atlanta (e.g. East US) is fine.
2. Open **SQL Editor → New query**, paste everything from `supabase/schema.sql`.
3. At the bottom of that file, **replace the three placeholder emails** with the real emails for Andres, Esteban and Isabella (add or remove lines as needed), then click **Run**.
4. Go to **Project Settings → API** and copy:
   - **Project URL**
   - **anon public** key

   The anon key is safe in the browser. The database security rules only let your team's emails in.

## 2. Run it on your computer (optional)

```bash
npm install
cp .env.example .env.local      # then paste your URL and anon key into .env.local
npm run dev                      # opens http://localhost:5173
```

In Supabase → **Authentication → URL Configuration**, add `http://localhost:5173` under **Redirect URLs** so the login link works locally.

## 3. Deploy on Vercel

**Option A: GitHub (recommended)**
1. Create a new GitHub repo and upload the **contents** of this folder to the root of the repo. `package.json` must sit at the top level of the repo, not inside a subfolder.
2. In [vercel.com](https://vercel.com) → **Add New → Project** → import the repo. Vercel detects **Vite** automatically (build: `npm run build`, output: `dist`).
3. Under **Environment Variables**, add:
   - `VITE_SUPABASE_URL` = your Project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon public key
4. Click **Deploy**.

**Option B: from your computer**
```bash
npx vercel            # follow the prompts, then add the two env vars in the Vercel dashboard
npx vercel --prod
```

## 4. Connect the login to your Vercel URL

In Supabase → **Authentication → URL Configuration**:
- **Site URL:** your Vercel URL (e.g. `https://ag-systems-map.vercel.app`)
- **Redirect URLs:** add the same URL (and `http://localhost:5173` if you run it locally)

Now open the site, enter your email, click the link in your inbox and you're in. **The first person to sign in saves the starting map** for the whole team.

---

## Everyday use

- **Edit a card:** click it. Set up to 3 owners, how often, the daily block, the "When" (e.g. *Monday*, *third Tuesday*, *last Friday*, *1st*, *month end*), the tool and the description.
- **Status (top right):** "Saved for your team" means it's stored. Teammates see changes live without reloading.
- **Rhythm & daily blocks:** each person's morning, during-the-day and close tasks, plus everything weekly, every 15 days, monthly and quarterly.
- **Notion calendar:** in Rhythm, pick the month → **Copy calendar prompt** → paste it to Claude. It creates the entries in AG's General Calendar and skips any that already exist.

## Team access

Add or remove people in Supabase → SQL Editor:

```sql
insert into public.team_members (email, name) values ('new@person.com', 'Name');
delete from public.team_members where email = 'old@person.com';
```

Someone who signs in with an email that isn't on the list sees "View only — your email isn't on the team list" and can't load or change anything.

## Files

| File | What it is |
|---|---|
| `index.html` | Page layout and styles (same look as the Retainer map) |
| `src/main.js` | All the app logic plus the Supabase connection |
| `src/seed.json` | The starting map (your current departments, systems and cards) |
| `supabase/schema.sql` | Tables, security rules, live updates and the team list |
| `.env.example` | The two keys Vercel / your computer need |

## Backups

The whole map lives in one row of `company_maps`. To back it up: Supabase → **Table Editor → company_maps** → open the `main` row → copy the `data` JSON. Supabase's daily backups (paid plans) cover it too.
