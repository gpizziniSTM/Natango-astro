import { useMemo, useState } from 'react';

function eur(value) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
}

function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${value}T12:00:00`));
}

export default function GoogleCampaignDashboard({ initialPlan, policy, initialErrors }) {
  const [plan, setPlan] = useState(initialPlan);
  const [health, setHealth] = useState(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const keywordCount = useMemo(
    () => plan.adGroups.reduce((total, group) => total + group.keywords.length, 0),
    [plan.adGroups],
  );
  const allPaused = plan.adGroups.every((group) => group.status === 'PAUSED') && plan.responsiveSearchAd.status === 'PAUSED';
  const approved = plan.approval?.approved === true;

  async function runHealthcheck() {
    setBusy('health');
    setMessage('');
    const response = await fetch('/api/google-dashboard/healthcheck', { method: 'POST' });
    const payload = await response.json();
    setHealth(payload);
    if (!payload.ok) setMessage(payload.error || 'Verifica API non riuscita.');
    setBusy('');
  }

  async function approvePlan() {
    setBusy('approve');
    setMessage('');
    const response = await fetch('/api/google-dashboard/approve', { method: 'POST' });
    const payload = await response.json();
    if (payload.ok) {
      setPlan(payload.plan);
      setMessage('Piano dry-run approvato. Nessuna campagna è stata creata su Google.');
    } else {
      setMessage((payload.errors || [payload.error || 'Approvazione non riuscita.']).join(' '));
    }
    setBusy('');
  }

  return (
    <main className="google-shell">
      <header className="topbar">
        <div className="brand">
          <img src="/wp-content/uploads/2025/11/logo-natango-no-sf-768x768.png" alt="Natango" />
          <div><span>Natango Ads</span><h1>Google Search - piano settembre 2026</h1></div>
        </div>
        <nav><a href="/meta-dashboard">Meta</a><a className="active" href="/google-dashboard">Google</a></nav>
      </header>

      <section className="status-grid">
        <article><span>Account</span><strong>{plan.account.name}</strong><small>{plan.account.id}</small></article>
        <article><span>Budget iniziale</span><strong>{eur(plan.campaign.initialAuthorizedTotalEur)}</strong><small>Estensione fino a {eur(plan.campaign.conditionalMaxTotalEur)} con nuova approvazione</small></article>
        <article><span>Stato piano</span><strong>{approved ? 'Approvato' : 'Da approvare'}</strong><small>Creazione Google sempre bloccata</small></article>
        <article><span>Sicurezza</span><strong>{allPaused ? 'Tutto in pausa' : 'Controllo richiesto'}</strong><small>Dry-run, nessuna scrittura</small></article>
      </section>

      {message && <p className={message.includes('approvato') ? 'notice ok' : 'notice'}>{message}</p>}

      <section className="dashboard-grid">
        <article className="panel span-2">
          <div className="panel-title"><div><span>Campagna</span><h2>{plan.campaign.name}</h2></div><b>{plan.campaign.status}</b></div>
          <div className="facts">
            <div><span>Avvio pubblicità</span><strong>{formatDate(plan.campaign.startDate)}</strong></div>
            <div><span>Open day</span><strong>{formatDate(plan.campaign.openDay)}</strong></div>
            <div><span>Lezione ordinaria</span><strong>{formatDate(plan.campaign.firstRegularLesson)}</strong></div>
            <div><span>Budget medio</span><strong>{eur(plan.campaign.averageDailyBudgetEur)}/giorno</strong></div>
          </div>
          <a className="landing" href={plan.campaign.destinationUrl} target="_blank" rel="noreferrer">{plan.campaign.destinationUrl}</a>
        </article>

        <article className="panel">
          <div className="panel-title"><div><span>Offerta</span><h2>Principianti assoluti</h2></div></div>
          <ul>
            <li><b>4 lezioni gratuite</b> dalla prima presenza</li>
            <li>Prezzo standard: <b>{eur(plan.offer.standardMonthlyPriceEur)}/mese</b></li>
            <li>Under 40: <b>{eur(plan.offer.under40MonthlyPriceEur)}/mese</b></li>
            <li>Quota annuale: <b>{eur(plan.offer.annualMembershipFeeEur)}</b></li>
            <li>Nessun partner richiesto</li>
          </ul>
        </article>

        <article className="panel span-2">
          <div className="panel-title"><div><span>Struttura Search</span><h2>{plan.adGroups.length} gruppi, {keywordCount} parole chiave</h2></div></div>
          <div className="groups">
            {plan.adGroups.map((group) => (
              <section key={group.name}>
                <h3>{group.name}</h3>
                <div className="chips">{group.keywords.map((keyword) => <span key={`${keyword.text}-${keyword.matchType}`}>{keyword.text} <small>{keyword.matchType}</small></span>)}</div>
              </section>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-title"><div><span>Annuncio responsive</span><h2>Anteprima messaggi</h2></div></div>
          <div className="ad-preview">
            <small>Annuncio · natango.org</small>
            <h3>{plan.responsiveSearchAd.headlines.slice(0, 3).join(' | ')}</h3>
            <p>{plan.responsiveSearchAd.descriptions[0]}</p>
          </div>
          <details><summary>Tutti i titoli e descrizioni</summary><ul>{plan.responsiveSearchAd.headlines.map((item) => <li key={item}>{item}</li>)}</ul></details>
        </article>

        <article className="panel">
          <div className="panel-title"><div><span>Controlli</span><h2>Validazione dry-run</h2></div></div>
          <ul className="checks">
            <li className={initialErrors.length === 0 ? 'pass' : 'fail'}>Policy e limiti: {initialErrors.length === 0 ? 'validi' : initialErrors.join(' ')}</li>
            <li className="pass">Scritture Google: disabilitate</li>
            <li className="pass">Budget automatico: bloccato</li>
            <li className="pass">Search Partners e Display: disattivati</li>
            <li className={health?.ok ? 'pass' : ''}>API: {health?.ok ? 'account verificato' : 'da verificare'}</li>
          </ul>
          <button onClick={runHealthcheck} disabled={Boolean(busy)}>{busy === 'health' ? 'Verifica in corso...' : 'Verifica account Google'}</button>
          <button className="primary" onClick={approvePlan} disabled={Boolean(busy) || initialErrors.length > 0 || approved}>{approved ? 'Piano approvato' : busy === 'approve' ? 'Approvazione...' : 'Approva solo il dry-run'}</button>
          <p className="warning">L’approvazione non crea né attiva campagne. La creazione in pausa richiederà una conferma separata.</p>
        </article>

        <article className="panel">
          <div className="panel-title"><div><span>Esclusioni</span><h2>Parole negative iniziali</h2></div></div>
          <div className="chips negatives">{plan.campaignNegativeKeywords.map((item) => <span key={item}>{item}</span>)}</div>
        </article>
      </section>
    </main>
  );
}
