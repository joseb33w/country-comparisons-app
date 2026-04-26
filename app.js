(() => {
  'use strict';

  const API_BASE = 'https://restcountries.com/v3.1/all';
  const COUNTRY_FIELDS = [
    'cca3', 'name', 'capital', 'region', 'subregion', 'population', 'area', 'languages', 'currencies', 'flags',
    'independent', 'landlocked', 'continents', 'timezones', 'maps', 'latlng'
  ];
  const COUNTRY_CACHE_KEY = 'countryScopeCountriesV2';
  const COUNTRY_CACHE_MAX_AGE = 1000 * 60 * 60 * 24 * 14;
  const CURRENT_YEAR = new Date().getFullYear();

  const state = {
    countries: [],
    selected: [],
    profile: {
      name: '',
      birthYear: '',
      homeCode: '',
      languages: '',
      note: ''
    },
    metric: 'population',
    sort: 'name',
    query: '',
    region: 'all',
    hasLoadedCountries: false
  };

  const els = {};

  function init() {
    try {
      cacheElements();
      bindEvents();
      loadProfile();
      fetchCountries();
    } catch (error) {
      showToast('Something went wrong while starting the app. Check the console for details.');
      console.error('Init error:', error.message, error.stack);
    }
  }

  function cacheElements() {
    const ids = [
      'dataStatus', 'countrySearch', 'regionFilter', 'suggestions', 'countryCards', 'emptyState', 'selectedCount',
      'sortSelect', 'metricSelect', 'barChart', 'compareTable', 'clearBtn', 'surpriseBtn', 'focusCountryName',
      'focusCountryMeta', 'focusPopulation', 'focusArea', 'bioForm', 'bioName', 'bioYear', 'homeCountry',
      'bioLanguages', 'bioNote', 'bioResult', 'toast'
    ];
    ids.forEach((id) => { els[id] = document.getElementById(id); });
  }

  function bindEvents() {
    els.countrySearch.addEventListener('input', (event) => {
      try {
        state.query = event.target.value.trim().toLowerCase();
        renderSuggestions();
      } catch (error) { console.error('Search error:', error.message); }
    });

    els.regionFilter.addEventListener('change', (event) => {
      try {
        state.region = event.target.value;
        renderSuggestions();
      } catch (error) { console.error('Region filter error:', error.message); }
    });

    els.sortSelect.addEventListener('change', (event) => {
      try {
        state.sort = event.target.value;
        renderSelected();
      } catch (error) { console.error('Sort error:', error.message); }
    });

    els.metricSelect.addEventListener('change', (event) => {
      try {
        state.metric = event.target.value;
        renderChart();
      } catch (error) { console.error('Metric error:', error.message); }
    });

    els.clearBtn.addEventListener('click', () => {
      try {
        state.selected = [];
        renderAll();
        showToast('Comparison board cleared.');
      } catch (error) { console.error('Clear error:', error.message); }
    });

    els.surpriseBtn.addEventListener('click', () => {
      try {
        surpriseMe();
      } catch (error) { console.error('Surprise error:', error.message); }
    });

    els.bioForm.addEventListener('submit', (event) => {
      event.preventDefault();
      try {
        state.profile = {
          name: els.bioName.value.trim(),
          birthYear: els.bioYear.value.trim(),
          homeCode: els.homeCountry.value,
          languages: els.bioLanguages.value.trim(),
          note: els.bioNote.value.trim()
        };
        localStorage.setItem('countryScopeProfile', JSON.stringify(state.profile));
        renderBio();
        showToast('Your bio comparison was updated.');
      } catch (error) { console.error('Profile error:', error.message); }
    });
  }

  async function fetchCountries() {
    const cachedCountries = readCountryCache();
    const usedCache = Boolean(cachedCountries && cachedCountries.length);

    if (usedCache) {
      hydrateCountries(cachedCountries, 'cache');
      els.dataStatus.textContent = `${state.countries.length} countries ready from local cache. Refreshing live data…`;
    } else {
      els.dataStatus.textContent = 'Loading live country data…';
    }

    try {
      const raw = await fetchCountryFields(COUNTRY_FIELDS);
      const countries = normalizeCountryList(raw);
      if (!countries.length) throw new Error('REST Countries returned no usable countries.');
      writeCountryCache(countries);
      hydrateCountries(countries, 'live');
      els.dataStatus.textContent = `${state.countries.length} countries loaded live from REST Countries.`;
      if (usedCache) showToast('Live country data refreshed.');
    } catch (error) {
      console.error('Country data error:', error.message, error.stack);
      if (usedCache || state.countries.length) {
        els.dataStatus.textContent = `${state.countries.length} countries loaded instantly from cache. Live refresh is still unavailable.`;
        return;
      }
      els.dataStatus.textContent = 'Country data could not load. Please refresh or check your connection.';
      showToast('Unable to load live country data.');
    }
  }

  async function fetchCountryFields(fields) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const url = `${API_BASE}?fields=${fields.join(',')}`;
      const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`REST Countries request failed: ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error('REST Countries returned an unexpected response shape.');
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  function normalizeCountryList(raw) {
    return raw.map(normalizeCountry).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  }

  function hydrateCountries(countries, source) {
    const previousCodes = state.selected.map((country) => country.code);
    const starterCodes = ['USA', 'BRA', 'JPN', 'NGA'];
    const selectedCodes = state.hasLoadedCountries ? previousCodes : starterCodes;
    state.countries = countries;
    state.selected = selectedCodes.map((code) => state.countries.find((country) => country.code === code)).filter(Boolean);
    state.hasLoadedCountries = true;
    populateFilters();
    populateHomeCountries();
    applyProfileToForm();
    renderAll();
    if (source === 'cache') console.info('CountryScope rendered cached country data first for a faster start.');
  }

  function readCountryCache() {
    try {
      const stored = localStorage.getItem(COUNTRY_CACHE_KEY);
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      const isFresh = parsed && parsed.savedAt && Date.now() - parsed.savedAt < COUNTRY_CACHE_MAX_AGE;
      if (!isFresh || !Array.isArray(parsed.countries)) return null;
      return parsed.countries;
    } catch (error) {
      console.error('Country cache read error:', error.message);
      return null;
    }
  }

  function writeCountryCache(countries) {
    try {
      localStorage.setItem(COUNTRY_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), countries }));
    } catch (error) {
      console.error('Country cache write error:', error.message);
    }
  }

  function normalizeCountry(country) {
    if (!country || !country.name || !country.name.common) return null;
    const languages = country.languages ? Object.values(country.languages) : [];
    const currencies = country.currencies ? Object.values(country.currencies).map((currency) => `${currency.name}${currency.symbol ? ` (${currency.symbol})` : ''}`) : [];
    const density = country.area ? country.population / country.area : 0;
    return {
      code: country.cca3 || country.name.common.slice(0, 3).toUpperCase(),
      name: country.name.common,
      officialName: country.name.official || country.name.common,
      capital: Array.isArray(country.capital) && country.capital.length ? country.capital.join(', ') : 'No official capital',
      region: country.region || 'Unspecified',
      subregion: country.subregion || 'Unspecified',
      continents: Array.isArray(country.continents) ? country.continents.join(', ') : 'Unspecified',
      population: Number(country.population || 0),
      area: Number(country.area || 0),
      density,
      languages,
      currencies,
      flag: country.flags && country.flags.svg ? country.flags.svg : '',
      flagAlt: country.flags && country.flags.alt ? country.flags.alt : `${country.name.common} flag`,
      timezones: country.timezones || [],
      independent: country.independent,
      landlocked: country.landlocked,
      maps: country.maps || {},
      latlng: country.latlng || []
    };
  }

  function populateFilters() {
    const regions = [...new Set(state.countries.map((country) => country.region).filter(Boolean))].sort();
    els.regionFilter.innerHTML = '<option value="all">All regions</option>' + regions.map((region) => `<option value="${escapeHtml(region)}">${escapeHtml(region)}</option>`).join('');
  }

  function populateHomeCountries() {
    els.homeCountry.innerHTML = '<option value="">Choose a home country</option>' + state.countries.map((country) => `<option value="${escapeHtml(country.code)}">${escapeHtml(country.name)}</option>`).join('');
  }

  function loadProfile() {
    try {
      const stored = localStorage.getItem('countryScopeProfile');
      if (stored) state.profile = { ...state.profile, ...JSON.parse(stored) };
    } catch (error) {
      console.error('Profile load error:', error.message);
    }
  }

  function applyProfileToForm() {
    els.bioName.value = state.profile.name || '';
    els.bioYear.value = state.profile.birthYear || '';
    els.homeCountry.value = state.profile.homeCode || '';
    els.bioLanguages.value = state.profile.languages || '';
    els.bioNote.value = state.profile.note || '';
  }

  function renderAll() {
    renderSuggestions();
    renderSelected();
    renderChart();
    renderTable();
    renderBio();
    renderFocus();
  }

  function renderSuggestions() {
    if (!state.countries.length) return;
    const selectedCodes = new Set(state.selected.map((country) => country.code));
    const query = state.query;
    let list = state.countries.filter((country) => !selectedCodes.has(country.code));
    if (state.region !== 'all') list = list.filter((country) => country.region === state.region);
    if (query) {
      list = list.filter((country) => {
        const haystack = [country.name, country.officialName, country.capital, country.region, country.subregion, country.languages.join(' '), country.currencies.join(' ')].join(' ').toLowerCase();
        return haystack.includes(query);
      });
    }
    list = list.slice(0, 12);
    if (!list.length) {
      els.suggestions.innerHTML = '<div class="empty-state"><div>🔎</div><h3>No matches</h3><p>Try another search or region.</p></div>';
      return;
    }
    els.suggestions.innerHTML = list.map((country) => `
      <button class="suggestion-card" type="button" data-code="${escapeHtml(country.code)}">
        ${flagMarkup(country)}
        <span><strong>${escapeHtml(country.name)}</strong><small>${escapeHtml(country.capital)} · ${escapeHtml(country.region)}</small></span>
      </button>
    `).join('');
    els.suggestions.querySelectorAll('[data-code]').forEach((button) => {
      button.addEventListener('click', () => addCountry(button.dataset.code));
    });
  }

  function addCountry(code) {
    try {
      const country = state.countries.find((item) => item.code === code);
      if (!country) return;
      if (state.selected.some((item) => item.code === code)) return;
      state.selected.push(country);
      renderAll();
      showToast(`${country.name} added to the comparison.`);
    } catch (error) { console.error('Add country error:', error.message); }
  }

  function removeCountry(code) {
    try {
      state.selected = state.selected.filter((country) => country.code !== code);
      renderAll();
      showToast('Country removed.');
    } catch (error) { console.error('Remove country error:', error.message); }
  }

  function getSortedSelected() {
    const list = [...state.selected];
    if (state.sort === 'name') return list.sort((a, b) => a.name.localeCompare(b.name));
    return list.sort((a, b) => Number(b[state.sort] || 0) - Number(a[state.sort] || 0));
  }

  function renderSelected() {
    const list = getSortedSelected();
    els.selectedCount.textContent = `${list.length} selected`;
    els.emptyState.style.display = list.length ? 'none' : 'block';
    els.countryCards.innerHTML = list.map((country) => `
      <article class="country-card">
        <div class="card-head">
          ${flagMarkup(country)}
          <div class="card-title">
            <h3 title="${escapeHtml(country.name)}">${escapeHtml(country.name)}</h3>
            <p>${escapeHtml(country.region)} · ${escapeHtml(country.subregion)}</p>
          </div>
          <button class="remove-btn" type="button" data-remove="${escapeHtml(country.code)}" aria-label="Remove ${escapeHtml(country.name)}">×</button>
        </div>
        <div class="stat-grid">
          <div class="stat"><span>Population</span><strong>${formatNumber(country.population)}</strong></div>
          <div class="stat"><span>Area</span><strong>${formatNumber(country.area)} km²</strong></div>
          <div class="stat"><span>Density</span><strong>${formatNumber(country.density)} / km²</strong></div>
          <div class="stat"><span>Capital</span><strong>${escapeHtml(country.capital)}</strong></div>
        </div>
        <div class="tag-list">
          <span class="tag">${country.independent ? 'Independent' : 'Not independent / special status'}</span>
          <span class="tag">${country.landlocked ? 'Landlocked' : 'Coastal access'}</span>
          <span class="tag">${escapeHtml(country.languages.slice(0, 2).join(', ') || 'Languages unavailable')}</span>
        </div>
      </article>
    `).join('');
    els.countryCards.querySelectorAll('[data-remove]').forEach((button) => {
      button.addEventListener('click', () => removeCountry(button.dataset.remove));
    });
    renderTable();
    renderChart();
    renderFocus();
    renderBio();
  }

  function renderChart() {
    const list = getSortedSelected();
    if (!list.length) {
      els.barChart.innerHTML = '<div class="empty-state"><div>📊</div><h3>No chart yet</h3><p>Add countries to visualize their stats.</p></div>';
      return;
    }
    const values = list.map((country) => Number(country[state.metric] || 0));
    const max = Math.max(...values, 1);
    els.barChart.innerHTML = list.map((country) => {
      const value = Number(country[state.metric] || 0);
      const pct = Math.max(3, Math.round((value / max) * 100));
      return `
        <div class="bar-row">
          <div class="bar-label">${flagMarkup(country)}<span>${escapeHtml(country.name)}</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
          <div class="bar-value">${formatMetric(value, state.metric)}</div>
        </div>
      `;
    }).join('');
  }

  function renderTable() {
    const list = getSortedSelected();
    if (!list.length) {
      els.compareTable.innerHTML = '<tr><td colspan="8"><strong>No countries selected.</strong> Add countries above to fill the table.</td></tr>';
      return;
    }
    els.compareTable.innerHTML = list.map((country) => `
      <tr>
        <td><strong>${escapeHtml(country.name)}</strong><br><small>${escapeHtml(country.officialName)}</small></td>
        <td>${escapeHtml(country.capital)}</td>
        <td>${escapeHtml(country.region)}<br><small>${escapeHtml(country.subregion)}</small></td>
        <td>${formatNumber(country.population)}</td>
        <td>${formatNumber(country.area)} km²</td>
        <td>${formatNumber(country.density)} / km²</td>
        <td>${escapeHtml(country.languages.join(', ') || '—')}</td>
        <td>${escapeHtml(country.currencies.join(', ') || '—')}</td>
      </tr>
    `).join('');
  }

  function renderFocus() {
    if (!state.selected.length) {
      els.focusCountryName.textContent = 'Global profile';
      els.focusCountryMeta.textContent = 'Choose countries to begin.';
      els.focusPopulation.textContent = '—';
      els.focusArea.textContent = '—';
      return;
    }
    const largest = [...state.selected].sort((a, b) => b.population - a.population)[0];
    const totalPopulation = state.selected.reduce((sum, country) => sum + country.population, 0);
    const totalArea = state.selected.reduce((sum, country) => sum + country.area, 0);
    els.focusCountryName.textContent = `${state.selected.length} countries selected`;
    els.focusCountryMeta.textContent = `${largest.name} has the largest population in your current board.`;
    els.focusPopulation.textContent = formatCompact(totalPopulation);
    els.focusArea.textContent = `${formatCompact(totalArea)} km²`;
  }

  function renderBio() {
    const profile = state.profile;
    const home = state.countries.find((country) => country.code === profile.homeCode);
    if (!profile.name && !profile.birthYear && !profile.homeCode && !profile.languages && !profile.note) {
      els.bioResult.innerHTML = '<div class="bio-avatar">👤</div><h3>Add your details</h3><p>Your mini bio will be compared with the countries you select.</p>';
      return;
    }
    const age = profile.birthYear ? Math.max(0, CURRENT_YEAR - Number(profile.birthYear)) : null;
    const userLanguages = splitList(profile.languages).map((item) => item.toLowerCase());
    const matches = state.selected.map((country) => {
      const countryLanguages = country.languages.map((item) => item.toLowerCase());
      const languageMatches = userLanguages.filter((lang) => countryLanguages.some((countryLang) => countryLang.includes(lang) || lang.includes(countryLang)));
      const sameRegion = home && country.region === home.region;
      const popRatio = home && home.population && country.population ? country.population / home.population : null;
      const areaRatio = home && home.area && country.area ? country.area / home.area : null;
      return { country, languageMatches, sameRegion, popRatio, areaRatio };
    });

    const matchHtml = matches.length ? matches.map((match) => {
      const parts = [];
      if (match.languageMatches.length) parts.push(`language overlap: ${escapeHtml(unique(match.languageMatches).join(', '))}`);
      if (match.sameRegion) parts.push(`same region as ${escapeHtml(home.name)}`);
      if (match.popRatio) parts.push(`${escapeHtml(match.country.name)} has ${formatRatio(match.popRatio)} the population of ${escapeHtml(home.name)}`);
      if (match.areaRatio) parts.push(`${formatRatio(match.areaRatio)} the area of your home country`);
      if (!parts.length) parts.push('a fresh contrast with your profile');
      return `<div class="match-chip"><strong>${escapeHtml(match.country.name)}:</strong> ${parts.join(' · ')}</div>`;
    }).join('') : '<div class="match-chip">Add countries to generate personal comparison notes.</div>';

    els.bioResult.innerHTML = `
      <div class="bio-avatar">${home ? flagEmoji(home.code) : '👤'}</div>
      <h3>${escapeHtml(profile.name || 'Your bio')}</h3>
      <p>${age !== null ? `${age} years old · ` : ''}${home ? `Home country: ${escapeHtml(home.name)} · ` : ''}${escapeHtml(profile.note || 'Personal comparison profile')}</p>
      <div class="match-list">${matchHtml}</div>
    `;
  }

  function surpriseMe() {
    if (!state.countries.length) return;
    const regions = [...new Set(state.countries.map((country) => country.region))];
    const picks = [];
    regions.forEach((region) => {
      const pool = state.countries.filter((country) => country.region === region);
      if (pool.length) picks.push(pool[Math.floor(Math.random() * pool.length)]);
    });
    while (picks.length < 5 && picks.length < state.countries.length) {
      const random = state.countries[Math.floor(Math.random() * state.countries.length)];
      if (!picks.some((country) => country.code === random.code)) picks.push(random);
    }
    state.selected = picks.slice(0, 6);
    renderAll();
    showToast('A cross-region country set is ready.');
  }

  function flagMarkup(country) {
    if (country.flag) return `<img class="flag" src="${escapeAttr(country.flag)}" alt="${escapeAttr(country.flagAlt)}" loading="lazy" decoding="async">`;
    return `<span class="flag" aria-label="Flag placeholder">${flagEmoji(country.code)}</span>`;
  }

  function flagEmoji(code) {
    if (!code || code.length < 2) return '🏳️';
    const chars = code.slice(0, 2).toUpperCase().split('').map((char) => 127397 + char.charCodeAt());
    return String.fromCodePoint(...chars);
  }

  function formatNumber(value) {
    if (!Number.isFinite(Number(value))) return '—';
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: value < 1000 ? 1 : 0 }).format(value);
  }

  function formatCompact(value) {
    if (!Number.isFinite(Number(value))) return '—';
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  }

  function formatMetric(value, metric) {
    if (metric === 'area') return `${formatCompact(value)} km²`;
    if (metric === 'density') return `${formatNumber(value)} / km²`;
    return formatCompact(value);
  }

  function formatRatio(value) {
    if (!Number.isFinite(value) || value <= 0) return 'about 0×';
    if (value >= 1) return `${formatNumber(value)}×`;
    return `${formatNumber(1 / value)}× less than`;
  }

  function splitList(value) {
    return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  }

  function unique(list) {
    return [...new Set(list)];
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  let toastTimer;
  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();