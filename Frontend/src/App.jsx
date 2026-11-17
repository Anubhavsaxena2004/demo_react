import { useEffect, useMemo, useState } from 'react';

const API = '/api/items';
const blankItem = { name: '', category: '', quantity: '', price: '' };
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

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

function App() {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState(blankItem);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [apiConnected, setApiConnected] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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

  useEffect(() => { loadItems(); }, []);

  const filteredItems = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return items;
    return items.filter((item) => `${item.name} ${item.category}`.toLowerCase().includes(value));
  }, [items, query]);

  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);
  const inventoryValue = items.reduce((sum, item) => sum + item.quantity * item.price, 0);

  function startEdit(item) {
    setEditingId(item.id);
    setForm({ name: item.name, category: item.category, quantity: String(item.quantity), price: String(item.price) });
    setError('');
    document.querySelector('#item-name')?.focus();
  }

  function resetForm() {
    setForm(blankItem);
    setEditingId(null);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const payload = { ...form, quantity: Number(form.quantity), price: Number(form.price) };
    try {
      await request(editingId ? `${API}/${editingId}` : API, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      resetForm();
      await loadItems();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
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

        <section className="workspace">
          <aside className="form-card">
            <div className="card-heading"><div className="heading-icon"><Icon name={editingId ? 'edit' : 'plus'} /></div><div><h2>{editingId ? 'Edit product' : 'Add a product'}</h2><p>{editingId ? 'Update the details below.' : 'Add something new to your catalog.'}</p></div></div>
            <form onSubmit={handleSubmit}>
              <label htmlFor="item-name">Product name</label><input id="item-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Ceramic mug" maxLength="80" required />
              <label htmlFor="category">Category</label><input id="category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Home & living" maxLength="50" required />
              <div className="field-row"><div><label htmlFor="quantity">Quantity</label><input id="quantity" type="number" min="0" step="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="0" required /></div><div><label htmlFor="price">Unit price</label><div className="price-input"><span>$</span><input id="price" type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="0.00" required /></div></div></div>
              <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : <>{editingId ? 'Save changes' : 'Add to inventory'} <span>→</span></>}</button>
              {editingId && <button className="cancel-button" type="button" onClick={resetForm}>Cancel editing</button>}
            </form>
            <div className="form-tip"><span>✳</span><p>Tip: Keep your quantities up to date for an accurate stock value.</p></div>
          </aside>

          <section className="inventory-card" id="inventory">
            <div className="inventory-heading"><div><h2>All products <span className="count-pill">{items.length}</span></h2><p>A complete list of everything you’re tracking.</p></div><label className="search-box"><Icon name="search" /><input aria-label="Search products" placeholder="Search products..." value={query} onChange={(e) => setQuery(e.target.value)} /></label></div>
            {error && <div className="error-banner" role="alert">{error}</div>}
            <div className="table-wrap"><table><thead><tr><th>PRODUCT</th><th>CATEGORY</th><th>QUANTITY</th><th>UNIT PRICE</th><th>VALUE</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
              {loading ? <tr><td colSpan="6" className="table-message">Loading your inventory…</td></tr> : filteredItems.length === 0 ? <tr><td colSpan="6" className="table-message">{query ? 'No products match your search.' : 'No products yet. Add your first one to get started.'}</td></tr> : filteredItems.map((item, index) => <tr key={item.id}><td><div className="product-cell"><span className={`product-mark mark-${index % 4}`}>{item.name.trim().charAt(0).toUpperCase()}</span><span className="product-name">{item.name}</span></div></td><td><span className="category-tag">{item.category}</span></td><td><span className="quantity">{item.quantity}</span> <span className="unit-label">units</span></td><td>{money.format(item.price)}</td><td className="value-cell">{money.format(item.quantity * item.price)}</td><td><div className="actions"><button className="icon-button" aria-label={`Edit ${item.name}`} title="Edit" onClick={() => startEdit(item)}><Icon name="edit" /></button><button className="icon-button delete-button" aria-label={`Delete ${item.name}`} title="Delete" onClick={() => deleteItem(item)}><Icon name="trash" /></button></div></td></tr>)}
            </tbody></table></div>
            <footer className="table-footer"><span>Showing <strong>{filteredItems.length}</strong> of <strong>{items.length}</strong> products</span><span className={`api-status ${apiConnected ? '' : 'api-offline'}`}><i /> {apiConnected ? 'API and database connected' : 'Service unavailable'}</span></footer>
          </section>
        </section>
        <footer className="page-footer"><span>Stockroom <span>·</span> A little more organized, every day.</span><span>Made for the details.</span></footer>
      </div>
    </main>
  );
}

export default App;
