# 🇬🇧 Blighty — Deployment Guide

A British year-guessing game. This guide gets it live on your VPS in about 10 minutes.

---

## What You're Deploying

```
public/
├── index.html          ← The game itself
├── admin/
│   └── index.html      ← Admin panel (add/edit questions)
└── data/
    └── questions.json  ← Your question sets (one per day)
```

---

## Step 1 — Upload Files to Your Server

From your local machine, copy the files to your VPS:

```bash
# Create the directory on the server
ssh user@YOUR_SERVER_IP "sudo mkdir -p /var/www/blighty/public/data"

# Upload everything
scp -r public/ user@YOUR_SERVER_IP:/var/www/blighty/

# Fix permissions
ssh user@YOUR_SERVER_IP "sudo chown -R www-data:www-data /var/www/blighty"
```

Or use SFTP (FileZilla, Transmit, etc.) — upload the `public/` folder to `/var/www/blighty/`.

---

## Step 2 — Install & Configure Nginx

```bash
# Install nginx if not already installed
sudo apt update && sudo apt install -y nginx

# Copy the config file
sudo cp nginx.conf /etc/nginx/sites-available/blighty

# Enable it
sudo ln -s /etc/nginx/sites-available/blighty /etc/nginx/sites-enabled/
sudo nginx -t          # test config
sudo systemctl reload nginx
```

**Edit the config first** — open `/etc/nginx/sites-available/blighty` and change:
```
server_name YOUR_DOMAIN.com;
```
to your actual domain or IP address.

---

## Step 3 — Add HTTPS (Strongly Recommended)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d YOUR_DOMAIN.com
```

Certbot will automatically update your Nginx config. Done!

---

## Step 4 — Add Your Questions

1. Visit `https://YOUR_DOMAIN.com/admin/`
2. Log in with the password: **`blighty2024`** ← **CHANGE THIS** (see below)
3. Click **New Set**, choose a date, fill in 6 questions
4. Click **Export JSON**, then **Download**
5. Upload `questions.json` to `/var/www/blighty/public/data/questions.json` on your server

That's it! The game will automatically serve the right set each day.

---

## Changing the Admin Password

Open `public/admin/index.html` and find this line near the top of the `<script>` section:

```javascript
const ADMIN_PASSWORD = 'blighty2024';
```

Change it to something strong, save, and re-upload.

> **Note:** This is a simple client-side password check — fine for a private friends game. 
> For a public site, consider adding HTTP Basic Auth in Nginx instead.

---

## Question Format Reference

Questions are stored in `data/questions.json`. Each set has a date and 6 questions:

```json
{
  "sets": [
    {
      "date": "2025-03-15",
      "questions": [
        {
          "category": "History",
          "text": "The <strong>Channel Tunnel</strong> opened, connecting Britain to Europe.",
          "answer": 1994,
          "min": 1970,
          "max": 2010
        }
      ]
    }
  ]
}
```

**Tips:**
- Use `<strong>` tags to highlight key words (they appear in teal in the game)
- `min` and `max` set the range of the year slider — make them sensible!
- Set `min`/`max` to within ~30 years of the answer for the best difficulty
- If no exact date match, the game cycles through your sets — so having 7+ sets means you'll never run out

---

## Sharing With Friends

At the end of each game, players tap **Share My Score**. On iPhone/Android this opens the native share sheet. The shared text looks like:

```
🇬🇧 Blighty — 15 March
Score: 72/100

🟩 🟧 🟨 🟥 🟩 🟧

Play at blighty.app
```

Change `blighty.app` in `public/index.html` to your actual URL — search for `blighty.app` in the share text.

---

## Emoji Score Key

| Emoji | Meaning |
|-------|---------|
| 🟩 | Exact or within 3 years |
| 🟨 | Within 4–8 years |
| 🟧 | Within 9–15 years |
| 🟥 | More than 15 years off |

---

## Updating Questions

To add new sets (e.g. weekly), use the admin panel to add sets, export the JSON, and upload it to replace `data/questions.json` on your server.

No server restarts needed — just replace the file!

---

## Troubleshooting

**Game shows fallback questions, not my custom ones:**
- Make sure `data/questions.json` is at the right path on your server
- Check Nginx is serving the `/data/` directory
- Try opening `https://YOUR_DOMAIN.com/data/questions.json` directly in a browser

**Admin panel won't save:**
- The admin uses your browser's localStorage — it's per-browser
- If you clear browser data, you'll need to re-export and re-upload the JSON
- The JSON file on the server is the source of truth for the game

**Nginx config test fails:**
- Run `sudo nginx -t` to see the error
- Most likely the `server_name` line needs updating
