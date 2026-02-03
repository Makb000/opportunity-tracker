# Opportunity Tracker - Azure Deployment Guide

## Overview

This guide walks through deploying the Opportunity Tracker to Azure App Service with Azure Blob Storage for secure, UK-based data storage.

**Estimated time:** 30-45 minutes  
**Cost:** ~£10-12/month

---

## Prerequisites

- Azure subscription (free trial works)
- GitHub account
- Your existing CRM data (crm-backup-2026-02-03.json)

---

## Step 1: Create Azure Resources

### 1.1 Create Resource Group

1. Sign in to [Azure Portal](https://portal.azure.com)
2. Click **Create a resource** → search **Resource group**
3. Configure:
   - **Subscription:** Your subscription
   - **Resource group name:** `rg-opportunity-tracker`
   - **Region:** `UK South`
4. Click **Review + create** → **Create**

### 1.2 Create Storage Account

1. Click **Create a resource** → search **Storage account**
2. Configure:
   - **Resource group:** `rg-opportunity-tracker`
   - **Storage account name:** `stopp<yourname>` (must be globally unique, lowercase, no hyphens)
   - **Region:** `UK South`
   - **Performance:** Standard
   - **Redundancy:** LRS (Locally-redundant storage)
3. Click **Review + create** → **Create**
4. Once created, go to the Storage Account

### 1.3 Create Blob Container

1. In your Storage Account, go to **Data storage** → **Containers**
2. Click **+ Container**
3. Configure:
   - **Name:** `data`
   - **Public access level:** Private (no anonymous access)
4. Click **Create**

### 1.4 Get Storage Connection String

1. In Storage Account, go to **Security + networking** → **Access keys**
2. Click **Show** next to key1's Connection string
3. Click **Copy** — **save this somewhere secure**, you'll need it shortly

### 1.5 Enable Soft Delete (Recommended)

1. In Storage Account, go to **Data protection**
2. Enable **Enable soft delete for blobs**
3. Set retention to **7 days**
4. Click **Save**

---

## Step 2: Create App Service

### 2.1 Create App Service Plan & Web App

1. Click **Create a resource** → search **Web App**
2. Configure **Basics**:
   - **Resource group:** `rg-opportunity-tracker`
   - **Name:** `opp-tracker-<yourname>` (must be globally unique)
   - **Publish:** Code
   - **Runtime stack:** Node 20 LTS
   - **Operating System:** Linux
   - **Region:** `UK South`
   - **Pricing plan:** Click **Create new**
     - Name: `asp-opportunity-tracker`
     - Pricing tier: **Basic B1** (~£10/month)
3. Click **Review + create** → **Create**

### 2.2 Configure App Settings

1. Once created, go to your App Service
2. Go to **Settings** → **Environment variables**
3. Click **+ Add** and add these settings:

| Name | Value |
|------|-------|
| `AZURE_STORAGE_CONNECTION_STRING` | (paste the connection string from Step 1.4) |
| `STORAGE_CONTAINER_NAME` | `data` |
| `STORAGE_BLOB_NAME` | `crm-data.json` |

4. Click **Apply** → **Confirm**

### 2.3 Configure Authentication

1. Go to **Settings** → **Authentication**
2. Click **Add identity provider**
3. Select **Microsoft**
4. Configure:
   - **Supported account types:** Current tenant - Single tenant
   - **Restrict access:** Require authentication
   - **Unauthenticated requests:** HTTP 302 Found redirect
5. Click **Add**
6. **Add authorised users:**
   - Go to [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID** → **Enterprise applications**
   - Find the app registration created (same name as your Web App)
   - Go to **Users and groups** → **Add user/group**
   - Add yourself and your colleague

---

## Step 3: Set Up GitHub Repository

### 3.1 Create Private Repository

1. Go to [GitHub](https://github.com) and create a new **private** repository
2. Name it `opportunity-tracker`

### 3.2 Push Code to GitHub

```bash
# In the opportunity-tracker folder
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/opportunity-tracker.git
git push -u origin main
```

### 3.3 Configure GitHub Actions Secret

1. In Azure Portal, go to your App Service
2. Go to **Deployment** → **Deployment Center**
3. Click **Manage publish profile** → **Download publish profile**
4. Open the downloaded file in a text editor, copy ALL contents
5. In GitHub, go to your repository → **Settings** → **Secrets and variables** → **Actions**
6. Click **New repository secret**
   - Name: `AZURE_WEBAPP_PUBLISH_PROFILE`
   - Value: (paste entire contents of publish profile file)
7. Click **Add secret**

### 3.4 Update Workflow with Your App Name

1. Edit `.github/workflows/deploy.yml`
2. Change `AZURE_WEBAPP_NAME: opportunity-tracker` to match your actual App Service name (e.g., `opp-tracker-<yourname>`)
3. Commit and push

---

## Step 4: Initial Data Migration

### 4.1 Upload Your Existing Data

You have two options:

**Option A: Via Azure Portal**
1. Go to your Storage Account → **Containers** → `data`
2. Click **Upload**
3. Select your `crm-backup-2026-02-03.json` file
4. **Important:** Rename it to `crm-data.json` before uploading (or rename in Azure after)

**Option B: Via API (after deployment)**
```bash
# Replace URL with your App Service URL
curl -X PUT https://opp-tracker-yourname.azurewebsites.net/api/data \
  -H "Content-Type: application/json" \
  -d @crm-backup-2026-02-03.json
```

---

## Step 5: Deploy and Test

### 5.1 Trigger Deployment

1. Push any change to the `main` branch, or
2. Go to GitHub → **Actions** → **Deploy to Azure App Service** → **Run workflow**

### 5.2 Monitor Deployment

1. In GitHub Actions, watch the workflow run
2. Once complete (green checkmark), your app is live

### 5.3 Access Your App

1. Go to `https://opp-tracker-yourname.azurewebsites.net`
2. You'll be prompted to sign in with your Microsoft account
3. Your Opportunity Tracker should load with your data

### 5.4 Test Health Endpoint

```bash
curl https://opp-tracker-yourname.azurewebsites.net/api/health
```

Should return:
```json
{"status":"healthy","timestamp":"...","storage":"connected","container":"data","blob":"crm-data.json"}
```

---

## Step 6: Cowork Integration

### How Cowork Can Update Your Data

Cowork can push updates in two ways:

**1. Via GitHub (code + data changes)**
- Cowork commits changes to your repo
- GitHub Actions auto-deploys

**2. Via API (data-only changes)**
- Full sync: `PUT /api/data` with complete JSON
- Partial update: `PATCH /api/data` with specific arrays
- Single entity: `PATCH /api/opportunities/:id`

### API Endpoints Reference

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/data` | Fetch all data |
| PUT | `/api/data` | Replace all data |
| PATCH | `/api/data` | Partial update |
| PATCH | `/api/opportunities/:id` | Update single opportunity |
| DELETE | `/api/opportunities/:id` | Delete opportunity |
| PATCH | `/api/companies/:id` | Update single company |
| DELETE | `/api/companies/:id` | Delete company |
| PATCH | `/api/contacts/:id` | Update single contact |
| DELETE | `/api/contacts/:id` | Delete contact |
| PATCH | `/api/activities/:id` | Update single activity |
| DELETE | `/api/activities/:id` | Delete activity |
| GET | `/api/health` | Health check |
| GET | `/api/backup` | Download backup |

---

## Troubleshooting

### App shows "Application Error"
1. Check App Service **Log stream** for errors
2. Verify `AZURE_STORAGE_CONNECTION_STRING` is set correctly
3. Check Storage Account firewall isn't blocking access

### Data not saving
1. Check browser console for errors
2. Verify blob container exists and is named `data`
3. Check App Service logs for storage errors

### Authentication not working
1. Verify you've added users in Enterprise Applications
2. Check you're using the correct Microsoft account
3. Clear browser cookies and try again

### GitHub Actions failing
1. Check the `AZURE_WEBAPP_PUBLISH_PROFILE` secret is set
2. Verify the app name in `deploy.yml` matches your App Service
3. Check Actions logs for specific errors

---

## Security Checklist

- [x] Storage Account in UK South
- [x] Blob container set to Private
- [x] App Service authentication enabled
- [x] HTTPS enforced (default)
- [x] Soft delete enabled on blob storage
- [x] GitHub repository is private
- [x] Connection string stored as environment variable (not in code)

---

## Monthly Costs

| Resource | Cost |
|----------|------|
| App Service Basic B1 | ~£10-12 |
| Blob Storage (LRS) | ~£0.10 |
| Entra ID | Free |
| **Total** | **~£10-12/month** |

---

## Support

If you encounter issues, check:
1. Azure Portal → App Service → **Diagnose and solve problems**
2. Azure Portal → App Service → **Log stream**
3. GitHub Actions → Check workflow run logs
