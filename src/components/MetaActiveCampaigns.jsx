import { useEffect, useMemo, useState } from 'react';

function formatCurrency(value) {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function formatNumber(value) {
  return new Intl.NumberFormat('it-IT').format(Number(value || 0));
}

function formatPercent(value) {
  return `${Number(value || 0).toLocaleString('it-IT', { maximumFractionDigits: 2 })}%`;
}

function formatDate(value) {
  if (!value) {
    return 'n.d.';
  }

  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function statusTone(status) {
  if (status === 'ACTIVE') {
    return 'ok';
  }

  if (status === 'PAUSED') {
    return 'warn';
  }

  return '';
}

export default function MetaActiveCampaigns() {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadCampaigns() {
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch(`/api/meta-campaigns/active?t=${Date.now()}`, {
        headers: {
          'Cache-Control': 'no-cache',
        },
      });
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'Lettura campagne non riuscita.');
      }

      setData(payload);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadCampaigns();
  }, []);

  const campaigns = data?.campaigns ?? [];
  const totals = data?.totals ?? {};
  const lastUpdate = data?.fetchedAt ? formatDate(data.fetchedAt) : 'n.d.';

  const sortedCampaigns = useMemo(() => {
    return [...campaigns].sort((a, b) => {
      if (a.effectiveStatus === b.effectiveStatus) {
        return (b.insights?.spend || 0) - (a.insights?.spend || 0);
      }

      return a.effectiveStatus === 'ACTIVE' ? -1 : 1;
    });
  }, [campaigns]);

  return (
    <main className="dashboard-shell campaigns-shell">
      <header className="dashboard-topbar">
        <a href="/meta-dashboard?new=1" className="brand">
          <img src="/wp-content/uploads/2025/11/logo-natango-no-sf.png" alt="Natango" />
          <span>Campagne attive</span>
        </a>
        <div className="topbar-actions">
          <a href="/meta-dashboard?new=1" className="secondary-button">
            <i className="fas fa-table-columns" aria-hidden="true"></i>
            Dashboard
          </a>
          <button type="button" className="secondary-button" onClick={loadCampaigns} disabled={isLoading}>
            <i className="fas fa-rotate" aria-hidden="true"></i>
            Ricarica
          </button>
          <form method="post" action="/api/meta-auth/logout">
            <button type="submit" className="icon-button" title="Esci">
              <i className="fas fa-right-from-bracket" aria-hidden="true"></i>
            </button>
          </form>
        </div>
      </header>

      <section className="status-strip" aria-label="Riepilogo campagne">
        <div>
          <span>Campagne attive</span>
          <strong>{isLoading ? '...' : formatNumber(totals.activeCampaigns)}</strong>
          <small>{data?.account?.name || 'Account Meta'}</small>
        </div>
        <div>
          <span>Spesa 30 giorni</span>
          <strong>{isLoading ? '...' : formatCurrency(totals.spend)}</strong>
          <small>Solo dati letti da Meta</small>
        </div>
        <div>
          <span>Click</span>
          <strong>{isLoading ? '...' : formatNumber(totals.clicks)}</strong>
          <small>CTR {formatPercent(totals.ctr)}</small>
        </div>
        <div>
          <span>Lead</span>
          <strong>{isLoading ? '...' : formatNumber(totals.leads)}</strong>
          <small>CPC {formatCurrency(totals.cpc)}</small>
        </div>
        <div>
          <span>Aggiornamento</span>
          <strong>{lastUpdate}</strong>
          <small>{data?.readOnly ? 'Sola lettura' : 'In attesa'}</small>
        </div>
      </section>

      <section className="panel campaigns-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Meta Ads</span>
            <h1>Campagne e riscontri</h1>
          </div>
          <span className="pill ok">Read only</span>
        </div>

        {error ? (
          <div className="empty-state error-state">
            <i className="fas fa-triangle-exclamation" aria-hidden="true"></i>
            <strong>Non riesco a leggere le campagne</strong>
            <span>{error}</span>
          </div>
        ) : null}

        {!error && isLoading ? (
          <div className="empty-state">
            <i className="fas fa-circle-notch fa-spin" aria-hidden="true"></i>
            <strong>Carico i dati da Meta</strong>
          </div>
        ) : null}

        {!error && !isLoading && sortedCampaigns.length === 0 ? (
          <div className="empty-state">
            <i className="fas fa-chart-simple" aria-hidden="true"></i>
            <strong>Nessuna campagna attiva trovata</strong>
            <span>Quando creeremo o leggeremo campagne Meta, appariranno qui con click, spesa, lead e stato.</span>
          </div>
        ) : null}

        {!error && !isLoading && sortedCampaigns.length > 0 ? (
          <div className="campaign-table-wrap">
            <table className="campaign-table">
              <thead>
                <tr>
                  <th>Campagna</th>
                  <th>Stato</th>
                  <th>Budget</th>
                  <th>Spesa</th>
                  <th>Click</th>
                  <th>Lead</th>
                  <th>CTR</th>
                  <th>CPC</th>
                  <th>Aggiornata</th>
                  <th>Azione</th>
                </tr>
              </thead>
              <tbody>
                {sortedCampaigns.map((campaign) => (
                  <tr key={campaign.id}>
                    <td>
                      <strong>{campaign.name}</strong>
                      <small>{campaign.objective || campaign.id}</small>
                    </td>
                    <td>
                      <span className={`pill ${statusTone(campaign.effectiveStatus)}`}>{campaign.effectiveStatus}</span>
                    </td>
                    <td>
                      {campaign.dailyBudgetEur ? `${formatCurrency(campaign.dailyBudgetEur)} / giorno` : 'n.d.'}
                      {campaign.lifetimeBudgetEur ? <small>Totale {formatCurrency(campaign.lifetimeBudgetEur)}</small> : null}
                    </td>
                    <td>{formatCurrency(campaign.insights.spend)}</td>
                    <td>{formatNumber(campaign.insights.clicks)}</td>
                    <td>{formatNumber(campaign.insights.leads)}</td>
                    <td>{formatPercent(campaign.insights.ctr)}</td>
                    <td>{formatCurrency(campaign.insights.cpc)}</td>
                    <td>{formatDate(campaign.updatedTime)}</td>
                    <td>
                      <a href={`/meta-dashboard?campaignId=${encodeURIComponent(campaign.id)}`} className="secondary-button compact-button">
                        <i className="fas fa-pen-to-square" aria-hidden="true"></i>
                        Modifica
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </main>
  );
}
