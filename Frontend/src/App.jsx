import { useEffect, useMemo, useRef, useState } from 'react';

const API = '/api/items';
const blankItem = { name: '', category: '', quantity: '', price: '' };
const imageTypes = ['image/jpeg', 'image/png', 'image/webp'];
const maxImageBytes = 5 * 1024 * 1024;
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const clock = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
const activityLabels = {
  created: 'Added', updated: 'Updated', deleted: 'Deleted', 'photo-added': 'New photo for', 'photo-removed': 'Removed photo from',
};

async function request(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.message || 'Request failed. Please try again.');
  }
  return response.status === 204 ? null : response.json();
}

function Icon({ name }) {
  const paths = {
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    edit: <><path d="m15 5 4 4" /><path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Z" /></>,
    trash: <><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="m5 7 1 13h12l1-13M9 7V4h6v3" /></>,
    arrow: <><path d="M7 17 17 7" /><path d="M8 7h9v9" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function ServerChip({ tier, server }) {
  return <span className="server-chip"><span className="server-tier">{tier}</span><code>{server ? server.id : 'n/a'}</code>{server?.zone && <span className="server-zone">{server.zone}</span>}</span>;
}

function App() {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState(blankItem);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [apiConnected, setApiConnected] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [removeImage, setRemoveImage] = useState(false);
  const fileInput = useRef(null);
  const [zoomed, setZoomed] = useState(null);
  const lightbox = useRef(null);
  const [servers, setServers] = useState(null);
  const [checkingServers, setCheckingServers] = useState(false);
  const [activity, setActivity] = useState(null);

  // A native <dialog> gives Escape-to-close, focus trapping and a backdrop for free.
  useEffect(() => {
    const dialog = lightbox.current;
    if (!dialog) return;
    if (zoomed && !dialog.open) dialog.showModal();
    if (!zoomed && dialog.open) dialog.close();
  }, [zoomed]);

  useEffect(() => {
    if (!imageFile) {
      setPreviewUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(imageFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  async function loadItems() {
    try {
      setError('');
      setItems(await request(API));
      setApiConnected(true);
    } catch (err) {
      setApiConnected(false);
      setError(`${err.message} Check that the API service is running.`);
    } finally {
      setLoading(false);
    }
  }

  // Each check is a new request, so the load balancers may hand it to a different web or API server.
  // Only the CloudFormation stack labels its servers; elsewhere the strip stays hidden.
  async function loadServers() {
    setCheckingServers(true);
    try {
      const response = await fetch('/api/health', { cache: 'no-store' });
      const health = await response.json();
      const webId = response.headers.get('x-web-instance');
      const web = webId ? { id: webId, zone: response.headers.get('x-web-zone') } : null;
      setServers(web || health.instance ? { web, api: health.instance || null } : null);
    } catch {
      setServers(null);
    } finally {
      setCheckingServers(false);
    }
  }

  useEffect(() => { loadItems(); loadServers(); }, []);

  // Events reach DynamoDB through SQS a moment after each change, so the feed polls. A 503 means this
  // server has no queue configured: hide the panel and stop asking.
  useEffect(() => {
    let timer;
    let stopped = false;
    async function poll() {
      try {
        const response = await fetch('/api/activity', { cache: 'no-store' });
        if (response.status === 503) {
          setActivity(null);
          return;
        }
        if (response.ok) setActivity(await response.json());
      } catch {
        // Keep the last list and try again on the next tick.
      }
      if (!stopped) timer = setTimeout(poll, 4000);
    }
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  const filteredItems = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return items;
    return items.filter((item) => `${item.name} ${item.category}`.toLowerCase().includes(value));
  }, [items, query]);

  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);
  const inventoryValue = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const editingItem = items.find((item) => item.id === editingId);
  const shownImage = previewUrl || (!removeImage && editingItem?.imageUrl) || null;

  function clearImageChoice() {
    setImageFile(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  function chooseImage(event) {
    const file = event.target.files?.[0] || null;
    setError('');
    if (file && (!imageTypes.includes(file.type) || file.size > maxImageBytes)) {
      setError(file.size > maxImageBytes ? 'Images must be 5 MB or smaller.' : 'Choose a JPEG, PNG or WebP image.');
      clearImageChoice();
      return;
    }
    setImageFile(file);
    if (file) setRemoveImage(false);
  }

  function startEdit(item) {
    setEditingId(item.id);
    setForm({ name: item.name, category: item.category, quantity: String(item.quantity), price: String(item.price) });
    clearImageChoice();
    setRemoveImage(false);
    setError('');
    document.querySelector('#item-name')?.focus();
  }

  function resetForm() {
    setForm(blankItem);
    setEditingId(null);
    clearImageChoice();
    setRemoveImage(false);
  }

  // Save the product first, then send the photo: the backend needs the product's id to file the image under it in S3.
  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const payload = { ...form, quantity: Number(form.quantity), price: Number(form.price) };
    let saved = null;
    let failure = '';
    try {
      saved = await request(editingId ? `${API}/${editingId}` : API, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (imageFile) {
        const body = new FormData();
        body.append('image', imageFile);
        await request(`${API}/${saved.id}/image`, { method: 'POST', body });
      } else if (removeImage) {
        await request(`${API}/${saved.id}/image`, { method: 'DELETE' });
      }
    } catch (err) {
      failure = saved ? `Product saved, but the photo could not be updated: ${err.message}` : err.message;
    }
    // If only the photo failed, stay on the saved product so a retry updates it instead of creating a duplicate.
    if (!failure) resetForm();
    else if (saved) setEditingId(saved.id);
    if (saved) await loadItems();
    if (failure) setError(failure);
    setSaving(false);
  }

  async function deleteItem(item) {
    if (!window.confirm(`Delete “${item.name}” from your inventory?`)) return;
    try {
      setError('');
      await request(`${API}/${item.id}`, { method: 'DELETE' });
      if (editingId === item.id) resetForm();
      await loadItems();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Stockroom home"><span className="brand-mark">s.</span><span>stockroom</span></a>
        <div className="topbar-right"><span className="live-dot" /> Local workspace <span className="avatar">JD</span></div>
      </header>

      <div className="page" id="top">
        <section className="page-heading">
          <div><p className="eyebrow">YOUR BUSINESS, AT A GLANCE</p><h1>Inventory</h1><p className="subtitle">Keep your products in order and your day moving.</p></div>
          <a className="text-link" href="#inventory">View inventory <Icon name="arrow" /></a>
        </section>

        <section className="stats" aria-label="Inventory summary">
          <article className="stat-card"><span className="stat-label">Products</span><div className="stat-row"><strong>{items.length.toString().padStart(2, '0')}</strong><span className="stat-icon green">▦</span></div><span className="stat-note">Unique items in your catalog</span></article>
          <article className="stat-card"><span className="stat-label">Units in stock</span><div className="stat-row"><strong>{totalUnits.toLocaleString()}</strong><span className="stat-icon amber">◷</span></div><span className="stat-note">Across all products</span></article>
          <article className="stat-card"><span className="stat-label">Stock value</span><div className="stat-row"><strong>{money.format(inventoryValue)}</strong><span className="stat-icon blue">↗</span></div><span className="stat-note">Based on current quantities</span></article>
        </section>

        {servers && (
          <section className="served-by" aria-label="Servers that answered">
            <span className="served-label">Served by</span>
            <ServerChip tier="Web" server={servers.web} />
            <span className="served-arrow" aria-hidden="true">→</span>
            <ServerChip tier="API" server={servers.api} />
            <button className="link-button served-refresh" type="button" onClick={loadServers} disabled={checkingServers}>{checkingServers ? 'Checking…' : 'Check again'}</button>
          </section>
        )}

        <section className="workspace">
          <aside className="form-card">
            <div className="card-heading"><div className="heading-icon"><Icon name={editingId ? 'edit' : 'plus'} /></div><div><h2>{editingId ? 'Edit product' : 'Add a product'}</h2><p>{editingId ? 'Update the details below.' : 'Add something new to your catalog.'}</p></div></div>
            <form onSubmit={handleSubmit}>
              <label htmlFor="item-name">Product name</label><input id="item-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Ceramic mug" maxLength="80" required />
              <label htmlFor="category">Category</label><input id="category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Home & living" maxLength="50" required />
              <div className="field-row"><div><label htmlFor="quantity">Quantity</label><input id="quantity" type="number" min="0" step="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="0" required /></div><div><label htmlFor="price">Unit price</label><div className="price-input"><span>$</span><input id="price" type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="0.00" required /></div></div></div>
              <label htmlFor="item-image">Product photo <span className="optional">(optional)</span></label>
              <div className="image-field">
                <div className="image-preview">{shownImage ? <button className="preview-button" type="button" aria-label="View photo larger" onClick={() => setZoomed({ src: shownImage, name: form.name.trim() || 'Product photo' })}><img src={shownImage} alt="Product photo preview" /></button> : <span>No photo</span>}</div>
                <div className="image-controls">
                  <input ref={fileInput} id="item-image" className="file-input" type="file" accept={imageTypes.join(',')} onChange={chooseImage} />
                  <p className="image-hint">JPEG, PNG or WebP, up to 5 MB</p>
                  {imageFile
                    ? <button className="link-button" type="button" onClick={clearImageChoice}>Clear selection</button>
                    : editingItem?.imageUrl && (removeImage
                      ? <button className="link-button" type="button" onClick={() => setRemoveImage(false)}>Keep current photo</button>
                      : <button className="link-button" type="button" onClick={() => setRemoveImage(true)}>Remove photo</button>)}
                </div>
              </div>
              <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : <>{editingId ? 'Save changes' : 'Add to inventory'} <span>→</span></>}</button>
              {editingId && <button className="cancel-button" type="button" onClick={resetForm}>Cancel editing</button>}
            </form>
            <div className="form-tip"><span>✳</span><p>Tip: Keep your quantities up to date for an accurate stock value.</p></div>
          </aside>

          <section className="inventory-card" id="inventory">
            <div className="inventory-heading"><div><h2>All products <span className="count-pill">{items.length}</span></h2><p>A complete list of everything you’re tracking.</p></div><label className="search-box"><Icon name="search" /><input aria-label="Search products" placeholder="Search products..." value={query} onChange={(e) => setQuery(e.target.value)} /></label></div>
            {error && <div className="error-banner" role="alert">{error}</div>}
            <div className="table-wrap"><table><thead><tr><th>PRODUCT</th><th>CATEGORY</th><th>QUANTITY</th><th>UNIT PRICE</th><th>VALUE</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
              {loading ? <tr><td colSpan="6" className="table-message">Loading your inventory…</td></tr> : filteredItems.length === 0 ? <tr><td colSpan="6" className="table-message">{query ? 'No products match your search.' : 'No products yet. Add your first one to get started.'}</td></tr> : filteredItems.map((item, index) => <tr key={item.id}><td><div className="product-cell">{item.imageUrl ? <button className="photo-button" type="button" aria-label={`View photo of ${item.name}`} title="View photo" onClick={() => setZoomed({ src: item.imageUrl, name: item.name })}><img className="product-mark product-photo" src={item.imageUrl} alt="" loading="lazy" /></button> :<span className={`product-mark mark-${index % 4}`}>{item.name.trim().charAt(0).toUpperCase()}</span>}<span className="product-name">{item.name}</span></div></td><td><span className="category-tag">{item.category}</span></td><td><span className="quantity">{item.quantity}</span> <span className="unit-label">units</span></td><td>{money.format(item.price)}</td><td className="value-cell">{money.format(item.quantity * item.price)}</td><td><div className="actions"><button className="icon-button" aria-label={`Edit ${item.name}`} title="Edit" onClick={() => startEdit(item)}><Icon name="edit" /></button><button className="icon-button delete-button" aria-label={`Delete ${item.name}`} title="Delete" onClick={() => deleteItem(item)}><Icon name="trash" /></button></div></td></tr>)}
            </tbody></table></div>
            <footer className="table-footer"><span>Showing <strong>{filteredItems.length}</strong> of <strong>{items.length}</strong> products</span><span className={`api-status ${apiConnected ? '' : 'api-offline'}`}><i /> {apiConnected ? 'API and database connected' : 'Service unavailable'}</span></footer>
          </section>
        </section>

        {activity && (
          <section className="activity-card" aria-labelledby="activity-title">
            <h2 id="activity-title">Recent activity</h2>
            <p className="activity-note">Every change is sent to an SQS queue, and a worker saves it to DynamoDB. New events show up here within a few seconds.</p>
            {activity.length === 0
              ? <p className="activity-empty">No activity yet. Add or edit a product to see it arrive here.</p>
              : <ol className="activity-list">{activity.map((event) => <li key={event.id}><span className={`activity-dot dot-${event.action}`} aria-hidden="true" /><span className="activity-text">{activityLabels[event.action] || event.action} <strong>{event.itemName}</strong></span><span className="activity-meta">{clock.format(new Date(event.at))} · queued by <code>{event.queuedBy}</code> · saved by <code>{event.savedBy}</code></span></li>)}</ol>}
          </section>
        )}
        <footer className="page-footer"><span>Stockroom <span>·</span> A little more organized, every day.</span><span>Made for the details.</span></footer>
      </div>
      <dialog ref={lightbox} className="lightbox" aria-label={zoomed ? `Photo of ${zoomed.name}` : 'Product photo'} onClose={() => setZoomed(null)} onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
        {zoomed && (
          <figure className="lightbox-figure">
            <div className="lightbox-stage"><img src={zoomed.src} alt={`Photo of ${zoomed.name}`} /></div>
            <figcaption>{zoomed.name}</figcaption>
            <button className="lightbox-close" type="button" aria-label="Close photo" onClick={() => lightbox.current?.close()}>×</button>
          </figure>
        )}
      </dialog>
    </main>
  );
}

export default App;
