# Google sign-in setup

QA/4HANA Studio uses Google Identity Services for authentication. The browser receives a Google ID token, the Studio server verifies it, and Studio creates its own secure, HTTP-only session cookie.

## One-time setup

1. Open the [Google Auth Platform](https://console.cloud.google.com/auth/overview) in the Google Cloud console.
2. Configure the branding and audience for the application.
3. Create an OAuth client with application type **Web application**.
4. Add the exact Studio origin to **Authorized JavaScript origins**. For the default local server this is:

   `http://127.0.0.1:4502`

   If Studio is started on a different port, add that origin instead.
5. Copy the client ID ending in `.apps.googleusercontent.com`.
6. In QA/4HANA Studio, open the user menu, choose **Settings**, paste the ID under **Owner account**, and select **Save client ID**.
7. Use the official Google sign-in button. The first verified Google account becomes the single owner of this workspace.

Do not create or paste a client secret. The browser-based Google Identity Services flow requires the public web client ID only.

## Data continuity

Linking a Google account adds an access boundary around the existing workspace. It does not create a new workspace or alter the execution ledger, object repository, document database, tags, test cases, process suites, datasets, reports, or evidence archive.

After the owner is registered:

- only that Google account can create a Studio session;
- signing out clears the current session, not workspace data;
- restarting the server requires a new Google sign-in, but does not require registering again.

References: [Google Identity Services overview](https://developers.google.com/identity/gsi/web/guides/overview), [web setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid), and [server-side integration](https://developers.google.com/identity/gsi/web/guides/integrate).
