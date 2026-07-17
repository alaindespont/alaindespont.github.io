const grid = document.querySelector('#apps-grid');
const count = document.querySelector('#app-count');

function createAppCard(app) {
  const link = document.createElement('a');
  link.className = 'app-card';
  link.href = app.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.setAttribute('aria-label', `Open ${app.name}`);

  const preview = document.createElement('div');
  preview.className = 'preview';

  const iframe = document.createElement('iframe');
  iframe.src = app.url;
  iframe.title = `${app.name} preview`;
  iframe.loading = 'lazy';
  iframe.tabIndex = -1;
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');

  const footer = document.createElement('div');
  footer.className = 'card-footer';

  const name = document.createElement('span');
  name.className = 'app-name';
  name.textContent = app.name;

  const label = document.createElement('span');
  label.className = 'open-label';
  label.textContent = 'Open app →';

  preview.append(iframe);
  footer.append(name, label);
  link.append(preview, footer);

  return link;
}

async function loadApps() {
  try {
    const response = await fetch('./apps/apps.json', { cache: 'no-store' });

    if (!response.ok) {
      throw new Error(`Manifest request failed with status ${response.status}.`);
    }

    const apps = await response.json();

    if (!Array.isArray(apps)) {
      throw new TypeError('The apps manifest must contain an array.');
    }

    apps.sort((first, second) => first.name.localeCompare(second.name, undefined, {
      sensitivity: 'base'
    }));

    grid.replaceChildren();
    count.textContent = `${apps.length} ${apps.length === 1 ? 'app' : 'apps'}`;

    if (apps.length === 0) {
      grid.innerHTML = '<p class="status">No application was found in the <code>/apps</code> directory.</p>';
      return;
    }

    const fragment = document.createDocumentFragment();
    apps.forEach((app) => fragment.append(createAppCard(app)));
    grid.append(fragment);
  } catch (error) {
    console.error(error);
    count.textContent = '';
    grid.innerHTML = `
      <p class="status">
        Unable to load the applications. Generate <code>apps/apps.json</code> and serve the page through HTTP.
      </p>
    `;
  }
}

loadApps();
