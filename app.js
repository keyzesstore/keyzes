/* ============================================
   KEYZES MARKETPLACE - App Logic
   Storefront + Admin Panel
   All data persisted in localStorage
   ============================================ */

(function () {
    'use strict';

    // Optional runtime config loaded from config.js
    const APP_CONFIG = window.KEYZES_CONFIG || {};

    // ---- Storage Keys ----
    const STORAGE_PRODUCTS = 'keyzes_products';
    const STORAGE_SETTINGS = 'keyzes_settings';
    const STORAGE_CART = 'keyzes_cart';
    const STORAGE_CUSTOMER_PROFILES = 'keyzes_customer_profiles_v1';
    const STORAGE_CUSTOMER_ORDERS = 'keyzes_customer_orders_v1';
    const STORAGE_AFFILIATE_CODES = 'keyzes_affiliate_codes_v1';
    const STORAGE_PENDING_REF = 'keyzes_pending_ref_v1';
    const ADMIN_EMAIL = 'keyzes.store@gmail.com';

    // ---- Default Admin Credentials ----
    const DEFAULT_ADMIN = { username: 'admin', password: 'admin123' };

    // ---- Helpers ----
    function $(sel) { return document.querySelector(sel); }
    function $$(sel) { return document.querySelectorAll(sel); }
    function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

    function loadJSON(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key)) || fallback; }
        catch { return fallback; }
    }
    function saveJSON(key, data) { localStorage.setItem(key, JSON.stringify(data)); }

    function normalizeEmail(value) {
        return String(value || '').trim().toLowerCase();
    }

    function formatMoney(value) {
        return Number(value || 0).toFixed(2);
    }

    function saveCustomerProgramState() {
        saveJSON(STORAGE_CUSTOMER_PROFILES, customerProfiles);
        saveJSON(STORAGE_CUSTOMER_ORDERS, customerOrders);
        saveJSON(STORAGE_AFFILIATE_CODES, affiliateCodes);
    }

    function getCustomerProfile(email, createIfMissing = true) {
        const key = normalizeEmail(email);
        if (!key) return null;
        if (!customerProfiles[key] && createIfMissing) {
            customerProfiles[key] = {
                avatar: '',
                storeCredit: 0,
                affiliateBalance: 0,
                affiliateCode: '',
                referredBy: '',
                affiliateUses: 0,
                affiliateEarningsTotal: 0,
                affiliateHistory: [],
                affiliateUniqueUsers: [],
            };
            saveCustomerProgramState();
        }
        return customerProfiles[key] || null;
    }

    function getCustomerOrders(email) {
        const key = normalizeEmail(email);
        if (!key) return [];
        return Array.isArray(customerOrders[key]) ? customerOrders[key] : [];
    }

    function setCustomerOrders(email, orders) {
        const key = normalizeEmail(email);
        if (!key) return;
        customerOrders[key] = orders;
        saveCustomerProgramState();
    }

    function cleanAffiliateCode(code) {
        return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 18);
    }

    function generateAffiliateCode(seedName) {
        const stem = String(seedName || 'KEYZES').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'KEYZES';
        return stem + Math.floor(1000 + Math.random() * 9000);
    }

    function getRefOwnerEmail(code) {
        return affiliateCodes[cleanAffiliateCode(code)] || '';
    }

    function getActiveReferralCodeForCustomer(customer) {
        if (!customer) return '';
        const profile = getCustomerProfile(customer.email, false);
        if (!profile || !profile.referredBy) return '';
        const ownerEmail = getRefOwnerEmail(profile.referredBy);
        if (!ownerEmail || ownerEmail === normalizeEmail(customer.email)) return '';
        return profile.referredBy;
    }

    function getCheckoutPricing(customer, cartItems) {
        const subtotal = cartItems.reduce((sum, item) => sum + (getItemPrice(item) * item.qty), 0);
        const activeRefCode = getActiveReferralCodeForCustomer(customer);
        const discountAmount = activeRefCode ? subtotal * 0.05 : 0;
        const total = Math.max(0, subtotal - discountAmount);
        return {
            subtotal,
            discountAmount,
            total,
            activeRefCode,
        };
    }

    function recordOrderForCustomer(customer, cartItems, pricing, remoteOrderId) {
        if (!customer || !customer.email) return;
        const orderId = remoteOrderId || ('L-' + uid());
        const order = {
            id: orderId,
            createdAt: Date.now(),
            total: pricing.total,
            subtotal: pricing.subtotal,
            discount: pricing.discountAmount,
            refCode: pricing.activeRefCode || '',
            items: cartItems.map(item => {
                const p = products.find(pr => pr.id === item.id);
                return {
                    title: p ? p.title : item.id,
                    qty: item.qty,
                    variant: getItemVariantName(item),
                    unitPrice: getItemPrice(item),
                };
            }),
        };
        const existing = getCustomerOrders(customer.email);
        existing.unshift(order);
        setCustomerOrders(customer.email, existing);
    }

    function applyAffiliateCommission(customer, pricing, remoteOrderId) {
        if (!customer || !pricing.activeRefCode || !pricing.subtotal) return;
        const ownerEmail = getRefOwnerEmail(pricing.activeRefCode);
        const buyerEmail = normalizeEmail(customer.email);
        if (!ownerEmail || ownerEmail === buyerEmail) return;

        const commission = pricing.subtotal * 0.05;
        const ownerProfile = getCustomerProfile(ownerEmail, true);
        ownerProfile.affiliateBalance = Number(ownerProfile.affiliateBalance || 0) + commission;
        ownerProfile.affiliateEarningsTotal = Number(ownerProfile.affiliateEarningsTotal || 0) + commission;
        ownerProfile.affiliateUses = Number(ownerProfile.affiliateUses || 0) + 1;
        if (!Array.isArray(ownerProfile.affiliateUniqueUsers)) ownerProfile.affiliateUniqueUsers = [];
        if (!ownerProfile.affiliateUniqueUsers.includes(buyerEmail)) {
            ownerProfile.affiliateUniqueUsers.push(buyerEmail);
        }
        if (!Array.isArray(ownerProfile.affiliateHistory)) ownerProfile.affiliateHistory = [];
        ownerProfile.affiliateHistory.unshift({
            createdAt: Date.now(),
            orderId: remoteOrderId || ('L-' + uid()),
            buyerEmail,
            amount: pricing.subtotal,
            commission,
        });
        saveCustomerProgramState();
    }

    function applyPendingReferralToCustomer(customer) {
        if (!customer || !customer.email) return;
        const pendingCode = cleanAffiliateCode(localStorage.getItem(STORAGE_PENDING_REF));
        if (!pendingCode) return;

        const ownerEmail = getRefOwnerEmail(pendingCode);
        if (!ownerEmail || ownerEmail === normalizeEmail(customer.email)) {
            localStorage.removeItem(STORAGE_PENDING_REF);
            return;
        }

        const profile = getCustomerProfile(customer.email, true);
        if (!profile.referredBy) {
            profile.referredBy = pendingCode;
            saveCustomerProgramState();
            showToast('Affiliate discount activated (5%) for your account.', 'success');
        }
        localStorage.removeItem(STORAGE_PENDING_REF);
    }

    function captureReferralFromUrl() {
        const params = new URLSearchParams(window.location.search || '');
        const refCode = cleanAffiliateCode(params.get('ref'));
        if (!refCode) return;
        if (!getRefOwnerEmail(refCode)) return;

        localStorage.setItem(STORAGE_PENDING_REF, refCode);
        params.delete('ref');
        const cleanSearch = params.toString();
        const cleanUrl = window.location.pathname + (cleanSearch ? ('?' + cleanSearch) : '') + window.location.hash;
        window.history.replaceState({}, document.title, cleanUrl);
        showToast('Affiliate code applied. You will get 5% discount at checkout.', 'success');
    }

    function sanitizeCustomer(customer) {
        if (!customer) return null;
        const email = normalizeEmail(customer.email);
        const name = String(customer.name || '').trim();
        if (!email || !name) return null;
        return {
            id: customer.id || uid(),
            name,
            email,
        };
    }

    function customerFirstName(customer) {
        const name = customer && customer.name ? customer.name.trim() : '';
        return name ? name.split(/\s+/)[0] : 'Member';
    }

    function isConfigured(value) {
        return typeof value === 'string' && value.trim() && !value.includes('YOUR_');
    }

    function getAuthRedirectUrl() {
        if (isConfigured(APP_CONFIG.authRedirectUrl)) {
            return APP_CONFIG.authRedirectUrl.trim();
        }
        return window.location.origin + window.location.pathname;
    }

    function clearAuthCallbackUrl() {
        const cleanUrl = window.location.origin + window.location.pathname;
        if (window.location.href !== cleanUrl) {
            window.history.replaceState({}, document.title, cleanUrl);
        }
    }

    function showEmailConfirmError(msg) {
        const overlay = document.getElementById('emailConfirmOverlay');
        const loading = document.getElementById('emailConfirmLoading');
        const success = document.getElementById('emailConfirmSuccess');
        const error = document.getElementById('emailConfirmError');
        const errorMsg = document.getElementById('emailConfirmErrorMsg');
        if (!overlay || !error || !errorMsg) {
            showToast(msg || 'Could not confirm your email. The link may have expired.', 'error');
            return;
        }

        if (loading) loading.style.display = 'none';
        if (success) success.style.display = 'none';
        errorMsg.textContent = msg;
        error.style.display = 'flex';

        overlay.style.display = 'flex';
        overlay.style.visibility = 'visible';
        overlay.style.opacity = '1';
        overlay.classList.remove('closing');
        overlay.classList.add('active');
    }

    function hideEmailConfirmOverlay() {
        const overlay = document.getElementById('emailConfirmOverlay');
        if (!overlay) return;

        overlay.classList.remove('active', 'closing');
        overlay.style.opacity = '0';
        overlay.style.visibility = 'hidden';
        overlay.style.display = 'none';

        const loading = document.getElementById('emailConfirmLoading');
        const success = document.getElementById('emailConfirmSuccess');
        const error = document.getElementById('emailConfirmError');

        if (loading) loading.style.display = 'none';
        if (success) success.style.display = 'none';
        if (error) error.style.display = 'none';
    }

    function showEmailConfirmSuccessOverlay(title, message) {
        console.log('[Email Confirm Success] Called with title:', title);
        const overlay = document.getElementById('emailConfirmOverlay');
        const loading = document.getElementById('emailConfirmLoading');
        const success = document.getElementById('emailConfirmSuccess');
        const error = document.getElementById('emailConfirmError');
        
        console.log('[Email Confirm Success] Elements found:', {
            overlay: !!overlay,
            loading: !!loading,
            success: !!success,
            error: !!error
        });

        if (!overlay || !loading || !success) {
            console.warn('[Email Confirm] Missing overlay elements');
            showToast('Email confirmed. You are now logged in.', 'success');
            return;
        }

        // Update text content
        const titleEl = success.querySelector('.email-confirm-title');
        const subEl = success.querySelector('.email-confirm-sub');
        console.log('[Email Confirm Success] Title element found:', !!titleEl);
        console.log('[Email Confirm Success] Sub element found:', !!subEl);
        
        if (titleEl) titleEl.textContent = title || 'Email confirmed!';
        if (subEl) subEl.textContent = message || 'You are now logged in and ready to shop.';

        // Check parent visibility
        const parent = overlay.parentElement;
        console.log('[Email Confirm Success] Parent element:', parent?.tagName, 'display:', window.getComputedStyle(parent).display);
        
        // Hide all states first
        console.log('[Email Confirm Success] Hiding loading, showing success...');
        loading.style.display = 'none';
        if (error) error.style.display = 'none';
        
        // Show success state - be very explicit
        success.style.display = 'flex';
        success.style.visibility = 'visible';
        success.style.opacity = '1';
        
        overlay.style.display = 'flex';
        overlay.style.visibility = 'visible';
        overlay.style.opacity = '1';
        overlay.classList.remove('closing');
        overlay.classList.add('active');
        
        // Ensure parent isn't hiding it
        if (parent && parent.style.display === 'none') {
            console.warn('[Email Confirm Success] Parent was hidden, showing it...');
            parent.style.display = 'block';
        }
        
        console.log('[Email Confirm Success] After setting styles - overlay display:', window.getComputedStyle(overlay).display);
        console.log('[Email Confirm Success] Overlay should now be visible');

    }

    async function handleTokenHashConfirmation() {
        const searchParams = new URLSearchParams(window.location.search || '');
        const tokenHash = searchParams.get('token_hash');
        console.log('[Email Confirm] token_hash check:', tokenHash ? 'FOUND' : 'NOT FOUND');
        if (!tokenHash) return false;

        if (!authReady()) {
            console.error('[Email Confirm] Auth is not ready');
            showEmailConfirmError('Authentication is not configured. Please contact support.');
            return true;
        }

        console.log('[Email Confirm] Calling verifyOtp with token_hash:', tokenHash.substring(0,20) + '...');
        const { data, error } = await supabaseClient.auth.verifyOtp({
            token_hash: tokenHash,
            type: 'email',
        });

        if (error) {
            console.error('[Email Confirm] verifyOtp error:', error);
            showEmailConfirmError(error.message || 'Could not confirm your email. The link may have expired.');
            return true;
        }

        console.log('[Email Confirm] Verification successful, user:', data.user?.email);
        if (data && data.user) {
            setCurrentCustomer(mapSupabaseUserToCustomer(data.user));
        }

        clearAuthCallbackUrl();
        console.log('[Email Confirm] About to show success overlay...');
        showEmailConfirmSuccessOverlay('Email confirmed!', 'You are now logged in and ready to shop.');
        console.log('[Email Confirm] Success overlay call complete');
        return true;
    }

    function getAuthCallbackParams() {
        const searchParams = new URLSearchParams(window.location.search || '');
        const hashParams = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));

        const rawDescription = searchParams.get('error_description') || hashParams.get('error_description') || '';
        const errorDescription = rawDescription.replace(/\+/g, ' ').trim();

        return {
            type: hashParams.get('type') || searchParams.get('type') || '',
            error: searchParams.get('error') || hashParams.get('error') || '',
            errorDescription,
        };
    }

    function handleAuthCallbackFeedback() {
        const hasSearch = !!window.location.search;
        const hasHash = !!window.location.hash;
        if (!hasSearch && !hasHash) return;

        const callbackParams = getAuthCallbackParams();
        const description = callbackParams.errorDescription.toLowerCase();

        if (callbackParams.error) {
            if (description.includes('expired')) {
                const intro = callbackParams.type === 'recovery'
                    ? 'Your password reset link expired. Request a new reset email.'
                    : 'Your confirmation link expired. Log in to request a fresh verification email.';
                openCustomerAuth('login', intro);
                showToast(callbackParams.type === 'recovery'
                    ? 'Reset link expired. Request a new password reset email.'
                    : 'Verification link expired. Request a new email and try again.', 'error');
            } else {
                openCustomerAuth('login', 'We could not verify your email from that link. Please try again.');
                showToast('Email verification could not be completed.', 'error');
            }
            clearAuthCallbackUrl();
            return;
        }

        if (callbackParams.type === 'recovery') {
            openCustomerAuth('reset', 'Set your new password to finish account recovery.');
            showToast('Reset link accepted. Create your new password.', 'info');
            clearAuthCallbackUrl();
            return;
        }

        if (callbackParams.type === 'signup') {
            if (currentCustomer) {
                showEmailConfirmSuccessOverlay('Email confirmed!', 'You are now logged in and ready to shop.');
            } else {
                openCustomerAuth('login', 'Email confirmed successfully. Log in to continue shopping.');
                showToast('Email confirmed. You can now log in.', 'success');
            }
            clearAuthCallbackUrl();
        }
    }

    async function createRemoteOrder(customerEmail, cartItems, pricing) {
        if (!isConfigured(APP_CONFIG.supabaseUrl) || !isConfigured(APP_CONFIG.supabaseAnonKey)) {
            return { ok: false, reason: 'Supabase is not configured yet.' };
        }

        const computedSubtotal = cartItems.reduce((sum, item) => sum + (getItemPrice(item) * item.qty), 0);
        const subtotal = pricing && typeof pricing.total === 'number' ? pricing.total : computedSubtotal;
        const orderPayload = {
            customer_email: customerEmail,
            status: 'pending',
            subtotal,
            currency: 'USD',
            source: 'web',
        };

        const headers = {
            apikey: APP_CONFIG.supabaseAnonKey,
            Authorization: 'Bearer ' + APP_CONFIG.supabaseAnonKey,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
        };

        const orderResp = await fetch(APP_CONFIG.supabaseUrl.replace(/\/$/, '') + '/rest/v1/orders', {
            method: 'POST',
            headers,
            body: JSON.stringify(orderPayload),
        });

        if (!orderResp.ok) {
            return { ok: false, reason: 'Failed to create order in database.' };
        }

        const created = await orderResp.json();
        const orderId = created && created[0] && created[0].id;
        if (!orderId) return { ok: false, reason: 'No order ID returned from database.' };

        const itemsPayload = cartItems.map(item => {
            const p = products.find(pr => pr.id === item.id);
            const variant = p && p.variants && p.variants[item.variantIdx || 0];
            const unitPrice = getItemPrice(item);
            return {
                order_id: orderId,
                product_id: item.id,
                product_title: p ? p.title : item.id,
                variant_name: variant ? variant.name : null,
                unit_price: unitPrice,
                qty: item.qty,
                line_total: unitPrice * item.qty,
            };
        });

        const itemsResp = await fetch(APP_CONFIG.supabaseUrl.replace(/\/$/, '') + '/rest/v1/order_items', {
            method: 'POST',
            headers,
            body: JSON.stringify(itemsPayload),
        });

        if (!itemsResp.ok) {
            return { ok: false, reason: 'Order created but failed to save order items.' };
        }

        if (isConfigured(APP_CONFIG.orderEmailFunctionUrl)) {
            try {
                await fetch(APP_CONFIG.orderEmailFunctionUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: 'Bearer ' + APP_CONFIG.supabaseAnonKey,
                    },
                    body: JSON.stringify({
                        orderId,
                        customerEmail,
                        subtotal,
                        items: itemsPayload,
                    }),
                });
            } catch {
                // Keep checkout successful even if email send fails.
            }
        }

        return { ok: true, orderId };
    }

    // ---- State ----
    let products = loadJSON(STORAGE_PRODUCTS, []);
    let siteSettings = loadJSON(STORAGE_SETTINGS, {
        name: 'Keyzes',
        tagline: 'Your Trusted Digital Marketplace',
        description: 'Instant delivery of game keys, software licenses & more at the best prices.',
        username: DEFAULT_ADMIN.username,
        password: DEFAULT_ADMIN.password,
    });
    let cart = loadJSON(STORAGE_CART, []);
    let customerProfiles = loadJSON(STORAGE_CUSTOMER_PROFILES, {});
    let customerOrders = loadJSON(STORAGE_CUSTOMER_ORDERS, {});
    let affiliateCodes = loadJSON(STORAGE_AFFILIATE_CODES, {});
    let currentCustomer = null;
    let pendingVerificationEmail = '';

    const supabaseClient = (function createSupabaseClient() {
        if (!isConfigured(APP_CONFIG.supabaseUrl) || !isConfigured(APP_CONFIG.supabaseAnonKey)) return null;
        if (!window.supabase || typeof window.supabase.createClient !== 'function') return null;
        return window.supabase.createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey);
    })();

    let pendingCartAction = null;

    // Migrate old cart items that lack cartKey
    cart = cart.filter(item => item && item.id).map(item => {
        if (!item.cartKey) {
            item.variantIdx = item.variantIdx || 0;
            item.cartKey = item.id + '_v' + item.variantIdx;
        }
        return item;
    });
    saveJSON(STORAGE_CART, cart);

    // Seed demo products on first visit or if old data lacks variants
    if (products.length === 0 || (products.length > 0 && !products[0].variants)) {
        products = getSeedProducts();
        saveJSON(STORAGE_PRODUCTS, products);
    }

    captureReferralFromUrl();

    // ===========================
    //  STOREFRONT
    // ===========================

    const searchInput = $('#searchInput');
    const mobileSearchInput = $('#mobileSearchInput');
    const productsGrid = $('#productsGrid');
    const emptyState = $('#emptyState');
    const resultsCount = $('#resultsCount');
    const sortSelect = $('#sortSelect');
    const priceRange = $('#priceRange');
    const priceMin = $('#priceMin');
    const priceMax = $('#priceMax');
    const priceRangeValue = $('#priceRangeValue');
    const clearFiltersBtn = $('#clearFilters');

    // Current filter state
    let filters = {
        search: '',
        categories: [],
        platforms: [],
        priceMax: 500,
        priceMinVal: 0,
        sort: 'popular',
        tab: 'all',
    };

    const ITEMS_PER_PAGE = 16;
    let currentPage = 1;

    // Render storefront products
    function renderProducts() {
        let filtered = products.filter(p => {
            // Search
            if (filters.search && !p.title.toLowerCase().includes(filters.search.toLowerCase())) return false;
            // Category filter (checkboxes)
            if (filters.categories.length && !filters.categories.includes(p.category)) return false;
            // Tab override
            if (filters.tab !== 'all' && p.category !== filters.tab) return false;
            // Platform
            if (filters.platforms.length && !filters.platforms.includes(p.platform)) return false;
            // Price
            if (p.price > filters.priceMax) return false;
            if (filters.priceMinVal && p.price < filters.priceMinVal) return false;
            return true;
        });

        // Sort
        switch (filters.sort) {
            case 'price-low': filtered.sort((a, b) => a.price - b.price); break;
            case 'price-high': filtered.sort((a, b) => b.price - a.price); break;
            case 'newest': filtered.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); break;
            case 'popular': filtered.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || b.reviews - a.reviews); break;
        }

        resultsCount.textContent = filtered.length + ' product' + (filtered.length !== 1 ? 's' : '');

        if (filtered.length === 0) {
            productsGrid.innerHTML = '';
            emptyState.style.display = 'block';
            renderPagination(0);
            return;
        }
        emptyState.style.display = 'none';

        const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
        if (currentPage > totalPages) currentPage = totalPages;
        const start = (currentPage - 1) * ITEMS_PER_PAGE;
        const paged = filtered.slice(start, start + ITEMS_PER_PAGE);

        productsGrid.innerHTML = paged.map(p => {
            const badgeHtml = p.badge ? `<span class="product-badge badge-${p.badge}">${p.badge}</span>` : '';
            const origPrice = p.originalPrice ? `<span class="price-original">$${p.originalPrice.toFixed(2)}</span>` : '';
            const imgSrc = p.image || 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" fill="%23111627"><rect width="320" height="200"/><text x="50%" y="50%" fill="%235a6380" font-family="sans-serif" font-size="14" text-anchor="middle" dy=".35em">No Image</text></svg>');
            const catLabel = categoryLabel(p.category);
            const platLabel = platformLabel(p.platform);

            return `
            <div class="product-card" data-product-id="${p.id}">
                <div class="product-image">
                    <img src="${escapeAttr(imgSrc)}" alt="${escapeAttr(p.title)}" loading="lazy" onerror="this.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'320\\' height=\\'200\\' fill=\\'%23111627\\'><rect width=\\'320\\' height=\\'200\\'/><text x=\\'50%\\' y=\\'50%\\' fill=\\'%235a6380\\' font-family=\\'sans-serif\\' font-size=\\'14\\' text-anchor=\\'middle\\' dy=\\'.35em\\'>No Image</text></svg>')">
                    ${badgeHtml}
                    <span class="product-platform">${platLabel}</span>
                </div>
                <div class="product-info">
                    <span class="product-category">${catLabel}</span>
                    <h3 class="product-title">${escapeHtml(p.title)}</h3>
                    <div class="product-footer">
                        <div class="product-price">
                            <span class="price-current">${formatPriceRange(p)}</span>
                        </div>
                        <button class="add-cart-btn" data-cart-stop>Add</button>
                    </div>
                </div>
            </div>`;
        }).join('');

        renderPagination(totalPages);
    }

    function renderPagination(totalPages) {
        let container = document.getElementById('paginationControls');
        if (!container) {
            container = document.createElement('div');
            container.id = 'paginationControls';
            container.className = 'pagination';
            productsGrid.parentNode.insertBefore(container, emptyState);
        }
        if (totalPages <= 1) {
            container.innerHTML = '';
            return;
        }
        let html = '';
        html += `<button class="page-btn${currentPage === 1 ? ' disabled' : ''}" data-page="prev">&laquo; Prev</button>`;
        for (let i = 1; i <= totalPages; i++) {
            html += `<button class="page-btn${i === currentPage ? ' active' : ''}" data-page="${i}">${i}</button>`;
        }
        html += `<button class="page-btn${currentPage === totalPages ? ' disabled' : ''}" data-page="next">Next &raquo;</button>`;
        container.innerHTML = html;
        container.querySelectorAll('.page-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const val = btn.dataset.page;
                if (val === 'prev' && currentPage > 1) currentPage--;
                else if (val === 'next' && currentPage < totalPages) currentPage++;
                else if (val !== 'prev' && val !== 'next') currentPage = parseInt(val);
                renderProducts();
                productsGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });
    }

    function categoryLabel(cat) {
        const map = { 'games': 'Games', 'software': 'Software', 'gift-cards': 'Gift Cards', 'subscriptions': 'Subscriptions', 'in-game': 'In-Game Items' };
        return map[cat] || cat;
    }

    function platformLabel(plat) {
        const map = { 'pc': 'PC', 'playstation': 'PlayStation', 'xbox': 'Xbox', 'nintendo': 'Nintendo', 'multi': 'Multi' };
        return map[plat] || plat;
    }

    function formatPriceRange(p) {
        const v = p.variants;
        if (!v || v.length <= 1) return `$${p.price.toFixed(2)}`;
        const prices = v.map(o => o.price);
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        return `$${min.toFixed(2)} - $${max.toFixed(2)}`;
    }

    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    function escapeAttr(str) {
        return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // Search
    function handleSearch(val) {
        filters.search = val.trim();
        currentPage = 1;
        renderProducts();
    }

    searchInput.addEventListener('input', e => {
        handleSearch(e.target.value);
        mobileSearchInput.value = e.target.value;
    });
    mobileSearchInput.addEventListener('input', e => {
        handleSearch(e.target.value);
        searchInput.value = e.target.value;
    });

    // Sort
    sortSelect.addEventListener('change', () => {
        filters.sort = sortSelect.value;
        currentPage = 1;
        renderProducts();
    });

    // Category tabs
    $$('.category-tabs .tab').forEach(tab => {
        tab.addEventListener('click', () => {
            $$('.category-tabs .tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            filters.tab = tab.dataset.category;
            currentPage = 1;
            renderProducts();
        });
    });

    // Checkboxes (sidebar)
    $$('.filter-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
            const type = cb.dataset.filter;
            if (type === 'category') {
                filters.categories = [...$$('.filter-checkbox[data-filter="category"]:checked')].map(c => c.value);
            } else if (type === 'platform') {
                filters.platforms = [...$$('.filter-checkbox[data-filter="platform"]:checked')].map(c => c.value);
            }
            currentPage = 1;
            renderProducts();
        });
    });

    // Price range
    priceRange.addEventListener('input', () => {
        filters.priceMax = Number(priceRange.value);
        priceRangeValue.textContent = '$' + priceRange.value;
        priceMax.value = priceRange.value;
        currentPage = 1;
        renderProducts();
    });

    priceMin.addEventListener('change', () => {
        filters.priceMinVal = Number(priceMin.value) || 0;
        currentPage = 1;
        renderProducts();
    });

    priceMax.addEventListener('change', () => {
        const v = Number(priceMax.value) || 500;
        filters.priceMax = v;
        priceRange.value = v;
        priceRangeValue.textContent = '$' + v;
        currentPage = 1;
        renderProducts();
    });

    // Clear filters
    clearFiltersBtn.addEventListener('click', () => {
        filters = { search: '', categories: [], platforms: [], priceMax: 500, priceMinVal: 0, sort: 'popular', tab: 'all' };
        currentPage = 1;
        $$('.filter-checkbox').forEach(cb => cb.checked = false);
        priceRange.value = 500;
        priceRangeValue.textContent = '$500';
        priceMin.value = '';
        priceMax.value = '';
        searchInput.value = '';
        mobileSearchInput.value = '';
        sortSelect.value = 'popular';
        $$('.category-tabs .tab').forEach(t => t.classList.remove('active'));
        $('.category-tabs .tab[data-category="all"]').classList.add('active');
        renderProducts();
    });

    // Filter title toggle
    $$('.filter-title').forEach(title => {
        title.addEventListener('click', () => {
            const targetId = title.dataset.toggle;
            const target = document.getElementById(targetId);
            if (target) {
                target.style.display = target.style.display === 'none' ? '' : 'none';
                title.classList.toggle('collapsed');
            }
        });
    });

    // Mobile menu
    const mobileMenuBtn = $('#mobileMenuBtn');
    const mobileNav = $('#mobileNav');
    mobileMenuBtn.addEventListener('click', () => {
        mobileMenuBtn.classList.toggle('active');
        mobileNav.classList.toggle('open');
    });

    // Mobile filter sidebar
    const mobileFilterBtn = $('#mobileFilterBtn');
    const sidebar = $('#sidebar');
    const filterOverlay = $('#filterOverlay');

    mobileFilterBtn.addEventListener('click', () => {
        sidebar.classList.add('open');
        filterOverlay.classList.add('open');
    });
    filterOverlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        filterOverlay.classList.remove('open');
    });

    // ===========================
    //  PRODUCT DETAIL MODAL
    // ===========================

    const productModal = $('#productModal');
    const productModalClose = $('#productModalClose');

    function updateModalPrice(p, variantIdx) {
        const variant = (variantIdx >= 0 && p.variants) ? p.variants[variantIdx] : null;
        const price = variant ? variant.price : p.price;
        const origPrice = variant && variant.originalPrice ? variant.originalPrice : p.originalPrice;
        $('#modalProductPrice').textContent = '$' + price.toFixed(2);
        if (origPrice && price < origPrice) {
            $('#modalProductOriginalPrice').textContent = '$' + origPrice.toFixed(2);
            $('#modalProductOriginalPrice').style.display = '';
            const discount = Math.round((1 - price / origPrice) * 100);
            $('#modalProductDiscount').textContent = '-' + discount + '%';
            $('#modalProductDiscount').style.display = '';
        } else {
            $('#modalProductOriginalPrice').style.display = 'none';
            $('#modalProductDiscount').style.display = 'none';
        }
    }

    function openProductModal(productId) {
        const p = products.find(pr => pr.id === productId);
        if (!p) return;
        productModal.dataset.currentProductId = productId;
        productModal.dataset.selectedVariant = '0';

        const imgSrc = p.image || 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" fill="#111627"><rect width="640" height="400"/><text x="50%" y="50%" fill="#5a6380" font-family="sans-serif" font-size="16" text-anchor="middle" dy=".35em">No Image</text></svg>');

        $('#modalProductImage').src = imgSrc;
        $('#modalProductImage').alt = p.title;
        $('#modalProductTitle').textContent = p.title;
        $('#modalProductCategory').textContent = categoryLabel(p.category);
        $('#modalProductPlatform').textContent = platformLabel(p.platform);
        $('#modalProductDescription').textContent = p.description || 'No description available.';

        // Warranty
        const warrantyEl = $('#modalProductWarranty');
        if (p.warranty) {
            $('#modalWarrantyText').textContent = 'Warranty: ' + p.warranty;
            warrantyEl.style.display = '';
        } else {
            warrantyEl.style.display = 'none';
        }

        // Variants
        const variantSelector = $('#variantSelector');
        const variantOptions = $('#variantOptions');
        if (p.variants && p.variants.length > 1) {
            variantSelector.style.display = '';
            variantOptions.innerHTML = p.variants.map((v, i) => {
                const origHtml = v.originalPrice ? `<span class="variant-orig">$${v.originalPrice.toFixed(2)}</span> ` : '';
                return `<button class="variant-btn${i === 0 ? ' active' : ''}" data-variant-idx="${i}">${escapeHtml(v.name)} - ${origHtml}$${v.price.toFixed(2)}</button>`;
            }).join('');
            // Set initial price from first variant
            updateModalPrice(p, 0);
            // Bind variant buttons
            variantOptions.querySelectorAll('.variant-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    variantOptions.querySelectorAll('.variant-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const idx = parseInt(btn.dataset.variantIdx);
                    productModal.dataset.selectedVariant = idx;
                    updateModalPrice(p, idx);
                });
            });
        } else {
            variantSelector.style.display = 'none';
            updateModalPrice(p, -1);
        }

        const badgeEl = $('#modalProductBadge');
        if (p.badge) {
            badgeEl.textContent = p.badge;
            badgeEl.className = 'product-badge badge-' + p.badge;
            badgeEl.style.display = '';
        } else {
            badgeEl.style.display = 'none';
        }

        productModal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    function closeProductModal() {
        productModal.classList.remove('open');
        document.body.style.overflow = '';
    }

    productModalClose.addEventListener('click', closeProductModal);
    productModal.addEventListener('click', e => {
        if (e.target === productModal) closeProductModal();
    });

    // Modal Add to Cart
    $('#modalAddCart').addEventListener('click', () => {
        const pid = productModal.dataset.currentProductId;
        const variantIdx = parseInt(productModal.dataset.selectedVariant || '0');
        if (pid) addToCart(pid, variantIdx, { closeModalOnSuccess: true, source: 'modal' });
    });

    // ---- Cart Logic ----
    function addToCart(productId, variantIdx, options = {}) {
        const p = products.find(pr => pr.id === productId);
        if (!p) return;

        if (!options.skipAuth && !currentCustomer) {
            pendingCartAction = {
                productId,
                variantIdx,
                closeModalOnSuccess: !!options.closeModalOnSuccess,
            };
            openCustomerAuth('login', 'Log in or create an account to add items to your cart.');
            return false;
        }

        const vi = (p.variants && p.variants.length > 1) ? (variantIdx || 0) : 0;
        const cartKey = productId + '_v' + vi;
        const existing = cart.find(item => item.cartKey === cartKey);
        if (existing) {
            existing.qty++;
        } else {
            cart.push({ id: productId, cartKey: cartKey, variantIdx: vi, qty: 1 });
        }
        saveJSON(STORAGE_CART, cart);
        updateCartBadge();
        if (cartView.style.display !== 'none') renderCart();
        if (options.closeModalOnSuccess) closeProductModal();
        showToast('Item added to your cart.', 'success');
        return true;
    }

    function runPendingCartAction() {
        if (!pendingCartAction || !currentCustomer) return;
        const queuedAction = pendingCartAction;
        pendingCartAction = null;
        addToCart(queuedAction.productId, queuedAction.variantIdx, {
            skipAuth: true,
            closeModalOnSuccess: queuedAction.closeModalOnSuccess,
        });
    }

    function removeFromCart(cartKey) {
        cart = cart.filter(item => item.cartKey !== cartKey);
        saveJSON(STORAGE_CART, cart);
        updateCartBadge();
        renderCart();
    }

    function updateCartQty(cartKey, delta) {
        const item = cart.find(i => i.cartKey === cartKey);
        if (!item) return;
        item.qty += delta;
        if (item.qty <= 0) {
            removeFromCart(cartKey);
            return;
        }
        saveJSON(STORAGE_CART, cart);
        updateCartBadge();
        renderCart();
    }

    function updateCartBadge() {
        const totalItems = cart.reduce((sum, item) => sum + item.qty, 0);
        let badge = document.querySelector('.cart-badge');
        const cartLink = document.querySelector('.cart-link');
        if (totalItems > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'cart-badge';
                cartLink.appendChild(badge);
            }
            badge.textContent = totalItems;
        } else if (badge) {
            badge.remove();
        }
    }

    function getItemPrice(item) {
        const p = products.find(pr => pr.id === item.id);
        if (!p) return 0;
        if (p.variants && p.variants[item.variantIdx]) return p.variants[item.variantIdx].price;
        return p.price;
    }

    function getItemVariantName(item) {
        const p = products.find(pr => pr.id === item.id);
        if (!p || !p.variants || !p.variants[item.variantIdx]) return '';
        return p.variants[item.variantIdx].name;
    }

    function renderCart() {
        const cartItems = $('#cartItems');
        const cartEmpty = $('#cartEmpty');
        const cartSummary = $('#cartSummary');

        if (cart.length === 0) {
            cartItems.innerHTML = '';
            cartEmpty.style.display = '';
            cartSummary.style.display = 'none';
            updateCheckoutState();
            return;
        }

        cartEmpty.style.display = 'none';
        cartSummary.style.display = '';

        const noImgSvg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" fill="#111627"><rect width="80" height="80"/><text x="50%" y="50%" fill="#5a6380" font-family="sans-serif" font-size="10" text-anchor="middle" dy=".35em">No Image</text></svg>');

        cartItems.innerHTML = cart.map(item => {
            const p = products.find(pr => pr.id === item.id);
            if (!p) return '';
            const imgSrc = p.image || noImgSvg;
            const unitPrice = getItemPrice(item);
            const lineTotal = (unitPrice * item.qty).toFixed(2);
            const variantName = getItemVariantName(item);
            const variantLabel = variantName ? ` &middot; ${escapeHtml(variantName)}` : '';
            return `
            <div class="cart-item" data-cart-key="${item.cartKey}">
                <img class="cart-item-img" src="${escapeAttr(imgSrc)}" alt="${escapeAttr(p.title)}">
                <div class="cart-item-info">
                    <div class="cart-item-title">${escapeHtml(p.title)}</div>
                    <div class="cart-item-category">${categoryLabel(p.category)}${variantLabel} &middot; ${platformLabel(p.platform)}</div>
                </div>
                <div class="cart-item-qty">
                    <button class="cart-qty-btn" data-qty-action="minus" data-qty-key="${item.cartKey}">&minus;</button>
                    <span class="cart-qty-num">${item.qty}</span>
                    <button class="cart-qty-btn" data-qty-action="plus" data-qty-key="${item.cartKey}">+</button>
                </div>
                <div class="cart-item-price">$${lineTotal}</div>
                <button class="cart-item-remove" data-remove-key="${item.cartKey}">&times;</button>
            </div>`;
        }).join('');

        const pricing = getCheckoutPricing(currentCustomer, cart);

        $('#cartSubtotal').textContent = '$' + formatMoney(pricing.subtotal);
        if (cartDiscountRow && cartDiscount) {
            const hasDiscount = pricing.discountAmount > 0;
            cartDiscountRow.style.display = hasDiscount ? '' : 'none';
            cartDiscount.textContent = '-$' + formatMoney(pricing.discountAmount);
        }
        $('#cartTotal').textContent = '$' + formatMoney(pricing.total);
        updateCheckoutState();

        // Bind qty and remove buttons
        cartItems.querySelectorAll('[data-qty-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.qtyKey;
                const delta = btn.dataset.qtyAction === 'plus' ? 1 : -1;
                updateCartQty(key, delta);
            });
        });

        cartItems.querySelectorAll('[data-remove-key]').forEach(btn => {
            btn.addEventListener('click', () => removeFromCart(btn.dataset.removeKey));
        });
    }

    // Cart back button
    $('#cartBackBtn').addEventListener('click', () => showStorefront());

    // Checkout button
    $('#checkoutBtn').addEventListener('click', async () => {
        if (!cart.length) {
            showToast('Your cart is empty.', 'error');
            return;
        }

        if (!currentCustomer) {
            openCustomerAuth('login', 'Log in or create an account before checkout.');
            updateCheckoutState();
            return;
        }

        const checkoutBtn = $('#checkoutBtn');
        const originalLabel = checkoutBtn.textContent;
        checkoutBtn.disabled = true;
        checkoutBtn.textContent = 'Processing...';

        const pricing = getCheckoutPricing(currentCustomer, cart);
        const cartSnapshot = cart.map(item => ({ ...item }));
        const result = await createRemoteOrder(currentCustomer.email, cart, pricing);
        checkoutBtn.textContent = originalLabel;
        updateCheckoutState();

        if (!result.ok) {
            showToast('Checkout setup is incomplete: ' + result.reason, 'error');
            return;
        }

        recordOrderForCustomer(currentCustomer, cartSnapshot, pricing, result.orderId);
        applyAffiliateCommission(currentCustomer, pricing, result.orderId);

        cart = [];
        saveJSON(STORAGE_CART, cart);
        renderCart();
        updateCartBadge();
        showToast('Order placed successfully. Order ID: ' + result.orderId, 'success');
    });

    // Initialize cart badge
    updateCartBadge();

    // Click on product card to open modal (delegated)
    productsGrid.addEventListener('click', e => {
        // Add to Cart button on product card
        const cartBtn = e.target.closest('[data-cart-stop]');
        if (cartBtn) {
            const card = cartBtn.closest('.product-card');
            if (card && card.dataset.productId) addToCart(card.dataset.productId, 0, { source: 'grid' });
            return;
        }

        const card = e.target.closest('.product-card');
        if (card && card.dataset.productId) {
            openProductModal(card.dataset.productId);
        }
    });

    // Close modal with Escape key
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && productModal.classList.contains('open')) {
            closeProductModal();
        }
        if (e.key === 'Escape' && customerAuthOverlay.classList.contains('open')) {
            closeCustomerAuth();
        }
    });

    // ===========================
    //  ADMIN PANEL
    // ===========================

    const adminLoginOverlay = $('#adminLoginOverlay');
    const adminLoginForm = $('#adminLoginForm');
    const adminLoginError = $('#adminLoginError');
    const adminView = $('#adminView');
    const storefrontView = $('#storefrontView');
    const siteFooter = $('#siteFooter');
    const cartView = $('#cartView');
    const customerSettingsView = $('#customerSettingsView');
    const accountTrigger = $('#accountTrigger');
    const mobileAccountTrigger = $('#mobileAccountTrigger');
    const mobileAdminTrigger = $('#mobileAdminTrigger');
    const settingsBackBtn = $('#settingsBackBtn');
    const customerProfileForm = $('#customerProfileForm');
    const customerProfileNameInput = $('#customerProfileName');
    const customerProfileEmailInput = $('#customerProfileEmail');
    const customerProfileError = $('#customerProfileError');
    const customerPasswordForm = $('#customerPasswordForm');
    const customerNewPassword = $('#customerNewPassword');
    const customerNewPasswordConfirm = $('#customerNewPasswordConfirm');
    const customerPasswordError = $('#customerPasswordError');
    const customerDeleteAccountBtn = $('#customerDeleteAccountBtn');
    const customerDeleteHelp = $('#customerDeleteHelp');
    const customerAuthOverlay = $('#customerAuthOverlay');
    const customerAuthTitle = $('#customerAuthTitle');
    const customerAuthIntro = $('#customerAuthIntro');
    const customerLoginForm = $('#customerLoginForm');
    const customerSignupForm = $('#customerSignupForm');
    const customerForgotForm = $('#customerForgotForm');
    const customerResetForm = $('#customerResetForm');
    const customerLoginError = $('#customerLoginError');
    const customerSignupError = $('#customerSignupError');
    const customerForgotError = $('#customerForgotError');
    const customerResetError = $('#customerResetError');
    const customerGuestActions = $('#customerGuestActions');
    const customerSessionPanel = $('#customerSessionPanel');
    const customerAccountBtn = $('#customerAccountBtn');
    const customerSessionAvatar = $('#customerSessionAvatar');
    const mobileGuestActions = $('#mobileGuestActions');
    const mobileSessionPanel = $('#mobileSessionPanel');
    const mobileCustomerAccountBtn = $('#mobileCustomerAccountBtn');
    const mobileSessionAvatar = $('#mobileSessionAvatar');
    const cartAuthNotice = $('#cartAuthNotice');
    const cartDiscountRow = $('#cartDiscountRow');
    const cartDiscount = $('#cartDiscount');
    const checkoutBtn = $('#checkoutBtn');
    const checkoutNote = document.querySelector('.checkout-note');
    const customerVerifyBox = $('#customerVerifyBox');
    const customerVerifyText = $('#customerVerifyText');
    const customerResendVerifyBtn = $('#customerResendVerifyBtn');
    const customerVerifyState = $('#customerVerifyState');
    const customerVerifyStateText = $('#customerVerifyStateText');
    const customerVerifyStateResendBtn = $('#customerVerifyStateResendBtn');
    const customerVerifyBackToLoginBtn = $('#customerVerifyBackToLoginBtn');
    const customerLoginEmail = $('#customerLoginEmail');
    const customerLoginPassword = $('#customerLoginPassword');
    const customerSignupName = $('#customerSignupName');
    const customerSignupEmail = $('#customerSignupEmail');
    const customerSignupPassword = $('#customerSignupPassword');
    const customerSignupConfirm = $('#customerSignupConfirm');
    const customerForgotPasswordBtn = $('#customerForgotPasswordBtn');
    const customerForgotBackBtn = $('#customerForgotBackBtn');
    const customerForgotEmail = $('#customerForgotEmail');
    const customerResetPassword = $('#customerResetPassword');
    const customerResetPasswordConfirm = $('#customerResetPasswordConfirm');
    const accountSideLinks = $$('.account-side-link');
    const accountPanes = $$('.account-pane');
    const accountHeroAvatar = $('#accountHeroAvatar');
    const accountHeroName = $('#accountHeroName');
    const accountHeroEmail = $('#accountHeroEmail');
    const customerProfileAvatarPreview = $('#customerProfileAvatarPreview');
    const customerProfileAvatarFile = $('#customerProfileAvatarFile');
    const customerProfileAvatarHelp = $('#customerProfileAvatarHelp');
    const customerOrdersList = $('#customerOrdersList');
    const storeCreditBalance = $('#storeCreditBalance');
    const affiliateBalance = $('#affiliateBalance');
    const accountTotalBalance = $('#accountTotalBalance');
    const storeCreditTopupBtn = $('#storeCreditTopupBtn');
    const affiliateCodeInput = $('#affiliateCodeInput');
    const affiliateCreateBtn = $('#affiliateCreateBtn');
    const affiliateCodeBox = $('#affiliateCodeBox');
    const affiliateCodeValue = $('#affiliateCodeValue');
    const affiliateCopyBtn = $('#affiliateCopyBtn');
    const affiliateUsesCount = $('#affiliateUsesCount');
    const affiliateUniqueCount = $('#affiliateUniqueCount');
    const affiliateEarnedTotal = $('#affiliateEarnedTotal');
    const affiliateChartBars = $('#affiliateChartBars');
    const affiliateWithdrawEmailBtn = $('#affiliateWithdrawEmailBtn');
    const affiliateTransferCreditBtn = $('#affiliateTransferCreditBtn');
    const affiliateActionMsg = $('#affiliateActionMsg');

    function isCurrentUserAdmin() {
        return !!currentCustomer && normalizeEmail(currentCustomer.email) === ADMIN_EMAIL;
    }

    function isDeleteAccountConfigured() {
        return isConfigured(APP_CONFIG.accountDeleteFunctionUrl);
    }

    function isValidEmail(value) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
    }

    function setInlineFieldError(input, message) {
        if (!input) return;
        const group = input.closest('.admin-form-group');
        if (!group) return;
        let errorEl = group.querySelector('.customer-inline-error');
        if (!errorEl) {
            errorEl = document.createElement('div');
            errorEl.className = 'customer-inline-error';
            group.appendChild(errorEl);
        }
        errorEl.textContent = message || '';
        group.classList.toggle('has-inline-error', !!message);
    }

    function clearInlineErrors(form) {
        if (!form) return;
        form.querySelectorAll('.admin-form-group').forEach(group => {
            group.classList.remove('has-inline-error');
            const errorEl = group.querySelector('.customer-inline-error');
            if (errorEl) errorEl.textContent = '';
        });
    }

    function validateLoginFields() {
        const email = normalizeEmail(customerLoginEmail.value);
        const password = customerLoginPassword.value;
        let valid = true;

        if (!email || !isValidEmail(email)) {
            setInlineFieldError(customerLoginEmail, 'Enter a valid email address.');
            valid = false;
        } else {
            setInlineFieldError(customerLoginEmail, '');
        }

        if (!password) {
            setInlineFieldError(customerLoginPassword, 'Enter your password.');
            valid = false;
        } else {
            setInlineFieldError(customerLoginPassword, '');
        }

        return valid;
    }

    function validateSignupFields() {
        const name = customerSignupName.value.trim();
        const email = normalizeEmail(customerSignupEmail.value);
        const password = customerSignupPassword.value;
        const confirmPassword = customerSignupConfirm.value;
        let valid = true;

        if (name.length < 2) {
            setInlineFieldError(customerSignupName, 'Enter your full name.');
            valid = false;
        } else {
            setInlineFieldError(customerSignupName, '');
        }

        if (!email || !isValidEmail(email)) {
            setInlineFieldError(customerSignupEmail, 'Enter a valid email address.');
            valid = false;
        } else {
            setInlineFieldError(customerSignupEmail, '');
        }

        if (password.length < 6) {
            setInlineFieldError(customerSignupPassword, 'Use at least 6 characters.');
            valid = false;
        } else {
            setInlineFieldError(customerSignupPassword, '');
        }

        if (!confirmPassword) {
            setInlineFieldError(customerSignupConfirm, 'Confirm your password.');
            valid = false;
        } else if (password !== confirmPassword) {
            setInlineFieldError(customerSignupConfirm, 'Passwords do not match.');
            valid = false;
        } else {
            setInlineFieldError(customerSignupConfirm, '');
        }

        return valid;
    }

    function mapSupabaseUserToCustomer(user) {
        if (!user || !user.email) return null;
        const fullName = user.user_metadata && user.user_metadata.full_name;
        const fallbackName = user.email.split('@')[0];
        return sanitizeCustomer({
            id: user.id,
            email: user.email,
            name: fullName || fallbackName,
        });
    }

    function authReady() {
        return !!supabaseClient;
    }

    function setCurrentCustomer(customer) {
        currentCustomer = sanitizeCustomer(customer);
        if (currentCustomer) {
            applyPendingReferralToCustomer(currentCustomer);
        }
        renderCustomerState();
    }

    function showVerifyBox(message, email) {
        if (!customerVerifyBox) return;
        pendingVerificationEmail = normalizeEmail(email || pendingVerificationEmail);
        customerVerifyText.textContent = message;
        customerVerifyBox.style.display = '';
        customerResendVerifyBtn.disabled = !pendingVerificationEmail;
    }

    function hideVerifyBox() {
        if (!customerVerifyBox) return;
        customerVerifyBox.style.display = 'none';
        customerVerifyText.textContent = '';
    }

    function enterVerificationState(email) {
        pendingVerificationEmail = normalizeEmail(email || pendingVerificationEmail);
        customerVerifyStateText.textContent = 'We sent a verification link to ' + pendingVerificationEmail + '. Please confirm your email, then come back and log in.';
        customerVerifyState.style.display = '';
        customerVerifyStateResendBtn.disabled = !pendingVerificationEmail;
        customerLoginForm.style.display = 'none';
        customerSignupForm.style.display = 'none';
        customerAuthTitle.textContent = 'Confirm Your Email';
    }

    function exitVerificationState() {
        customerVerifyState.style.display = 'none';
        customerVerifyStateText.textContent = '';
    }

    function updateCheckoutState() {
        const isSignedIn = !!currentCustomer;
        const pricing = getCheckoutPricing(currentCustomer, cart);
        if (cartAuthNotice) cartAuthNotice.style.display = !isSignedIn && cart.length ? '' : 'none';
        if (checkoutBtn) {
            checkoutBtn.disabled = !isSignedIn || !cart.length;
            checkoutBtn.textContent = isSignedIn ? 'Proceed to Checkout' : 'Log In to Checkout';
        }
        if (cartDiscountRow && cartDiscount) {
            const hasDiscount = pricing.discountAmount > 0;
            cartDiscountRow.style.display = hasDiscount ? '' : 'none';
            cartDiscount.textContent = '-$' + formatMoney(pricing.discountAmount);
        }
        if (checkoutNote) {
            if (!isSignedIn) {
                checkoutNote.textContent = 'Sign in to place your order and save your cart.';
            } else if (pricing.activeRefCode) {
                checkoutNote.textContent = '5% affiliate discount active (' + pricing.activeRefCode + '). Confirmation goes to ' + currentCustomer.email + '.';
            } else {
                checkoutNote.textContent = 'Order confirmation will be sent to ' + currentCustomer.email + '.';
            }
        }
    }

    function buildDefaultAvatar(name) {
        const initial = (name || 'K').trim().charAt(0).toUpperCase() || 'K';
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="100%" height="100%" fill="#1d2642"/><text x="50%" y="55%" text-anchor="middle" fill="#f6f7ff" font-size="74" font-family="Arial" font-weight="700">${initial}</text></svg>`;
        return 'data:image/svg+xml,' + encodeURIComponent(svg);
    }

    function resolveCustomerAvatar(customer) {
        if (!customer) return 'photos/keyzes-logo-no-backround.png';
        const profile = getCustomerProfile(customer.email, true);
        return profile.avatar || buildDefaultAvatar(customer.name || 'K');
    }

    function renderAffiliateChart(profile) {
        if (!affiliateChartBars) return;
        const days = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setHours(0, 0, 0, 0);
            d.setDate(d.getDate() - i);
            days.push(d);
        }
        const values = days.map(d => {
            const start = d.getTime();
            const end = start + 86400000;
            return (profile.affiliateHistory || []).reduce((sum, row) => {
                return row.createdAt >= start && row.createdAt < end ? sum + Number(row.commission || 0) : sum;
            }, 0);
        });
        const maxValue = Math.max(1, ...values);
        affiliateChartBars.innerHTML = values.map((value, idx) => {
            const height = Math.max(8, Math.round((value / maxValue) * 96));
            const label = days[idx].toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2);
            return `<div class="affiliate-chart-bar" style="height:${height}px" title="EUR ${formatMoney(value)}"><span class="affiliate-chart-day">${label}</span></div>`;
        }).join('');
    }

    function renderOrdersForCurrentCustomer() {
        if (!customerOrdersList || !currentCustomer) return;
        const orders = getCustomerOrders(currentCustomer.email);
        if (!orders.length) {
            customerOrdersList.innerHTML = '<p class="settings-hint" style="margin:0;">No orders yet.</p>';
            return;
        }
        customerOrdersList.innerHTML = orders.map(order => {
            const when = new Date(order.createdAt || Date.now()).toLocaleString();
            const items = (order.items || []).map(item => {
                const variantPart = item.variant ? ' - ' + escapeHtml(item.variant) : '';
                return `${escapeHtml(item.title)} x${item.qty}${variantPart}`;
            }).join('<br>');
            return `
            <div class="account-order-item">
                <div class="account-order-top">
                    <span>Order ${escapeHtml(String(order.id || 'N/A'))}</span>
                    <span>${escapeHtml(when)}</span>
                </div>
                <div class="account-order-items">${items}</div>
                <div class="account-order-top" style="margin-top:8px;margin-bottom:0;">
                    <span>${order.refCode ? 'Affiliate: ' + escapeHtml(order.refCode) : 'No affiliate discount'}</span>
                    <span class="account-order-total">EUR ${formatMoney(order.total || 0)}</span>
                </div>
            </div>`;
        }).join('');
    }

    function renderAccountProgramPanels() {
        if (!currentCustomer) return;
        const profile = getCustomerProfile(currentCustomer.email, true);

        if (accountHeroName) accountHeroName.textContent = currentCustomer.name || 'Account';
        if (accountHeroEmail) accountHeroEmail.textContent = currentCustomer.email || '';

        const avatarSrc = resolveCustomerAvatar(currentCustomer);
        if (customerSessionAvatar) customerSessionAvatar.src = avatarSrc;
        if (mobileSessionAvatar) mobileSessionAvatar.src = avatarSrc;
        if (accountHeroAvatar) accountHeroAvatar.src = avatarSrc;
        if (customerProfileAvatarPreview) customerProfileAvatarPreview.src = avatarSrc;

        if (storeCreditBalance) storeCreditBalance.textContent = formatMoney(profile.storeCredit) + ' EUR';
        if (affiliateBalance) affiliateBalance.textContent = formatMoney(profile.affiliateBalance) + ' EUR';
        if (accountTotalBalance) {
            const total = Number(profile.storeCredit || 0) + Number(profile.affiliateBalance || 0);
            accountTotalBalance.textContent = formatMoney(total) + ' EUR';
        }

        if (affiliateCodeBox) affiliateCodeBox.style.display = profile.affiliateCode ? '' : 'none';
        if (affiliateCodeValue) affiliateCodeValue.textContent = profile.affiliateCode || '-';
        if (affiliateUsesCount) affiliateUsesCount.textContent = String(profile.affiliateUses || 0);
        if (affiliateUniqueCount) affiliateUniqueCount.textContent = String((profile.affiliateUniqueUsers || []).length);
        if (affiliateEarnedTotal) affiliateEarnedTotal.textContent = formatMoney(profile.affiliateEarningsTotal || 0) + ' EUR';
        renderAffiliateChart(profile);
        renderOrdersForCurrentCustomer();
    }

    function renderCustomerState() {
        const isSignedIn = !!currentCustomer;
        const isAdminCustomer = isCurrentUserAdmin();
        const displayName = isSignedIn ? customerFirstName(currentCustomer) : 'Guest';
        const avatarSrc = isSignedIn ? resolveCustomerAvatar(currentCustomer) : 'photos/keyzes-logo-no-backround.png';

        customerGuestActions.style.display = isSignedIn ? 'none' : 'flex';
        customerSessionPanel.style.display = isSignedIn ? 'flex' : 'none';
        mobileGuestActions.style.display = isSignedIn ? 'none' : 'flex';
        mobileSessionPanel.style.display = isSignedIn ? 'flex' : 'none';
        if (accountTrigger) accountTrigger.style.display = 'none';
        if (mobileAccountTrigger) mobileAccountTrigger.style.display = 'none';
        if ($('#adminTrigger')) $('#adminTrigger').style.display = isAdminCustomer ? '' : 'none';
        if (mobileAdminTrigger) mobileAdminTrigger.style.display = isAdminCustomer ? '' : 'none';

        $('#customerSessionName').textContent = displayName;
        $('#mobileSessionName').textContent = displayName;
        if (customerSessionAvatar) customerSessionAvatar.src = avatarSrc;
        if (mobileSessionAvatar) mobileSessionAvatar.src = avatarSrc;
        if (accountHeroAvatar) accountHeroAvatar.src = avatarSrc;
        if (customerProfileAvatarPreview) customerProfileAvatarPreview.src = avatarSrc;

        if (customerSettingsView && customerSettingsView.style.display !== 'none' && (!isSignedIn || isAdminCustomer)) {
            showStorefront();
        }
        if (adminView.style.display !== 'none' && !isAdminCustomer) {
            showStorefront();
        }
        updateCheckoutState();
        if (isSignedIn) {
            renderAccountProgramPanels();
        }
    }

    function showForgotPasswordState() {
        exitVerificationState();
        hideVerifyBox();
        customerLoginForm.style.display = 'none';
        customerSignupForm.style.display = 'none';
        customerResetForm.style.display = 'none';
        customerForgotForm.style.display = '';
        customerForgotError.textContent = '';
        customerAuthTitle.textContent = 'Reset Your Password';
        customerAuthIntro.textContent = 'Enter your account email and we will send a password reset link.';
        $$('.customer-auth-tab').forEach(tab => {
            tab.classList.remove('active');
            tab.style.display = 'none';
        });
    }

    function showResetPasswordState() {
        exitVerificationState();
        hideVerifyBox();
        customerLoginForm.style.display = 'none';
        customerSignupForm.style.display = 'none';
        customerForgotForm.style.display = 'none';
        customerResetForm.style.display = '';
        customerResetError.textContent = '';
        customerAuthTitle.textContent = 'Create a New Password';
        customerAuthIntro.textContent = 'Set a new password for your account to finish recovery.';
        $$('.customer-auth-tab').forEach(tab => {
            tab.classList.remove('active');
            tab.style.display = 'none';
        });
    }

    function setAuthMode(mode) {
        const loginMode = mode !== 'signup';
        exitVerificationState();
        customerLoginForm.style.display = loginMode ? '' : 'none';
        customerSignupForm.style.display = loginMode ? 'none' : '';
        customerForgotForm.style.display = 'none';
        customerResetForm.style.display = 'none';
        clearInlineErrors(customerLoginForm);
        clearInlineErrors(customerSignupForm);
        customerLoginError.textContent = '';
        customerSignupError.textContent = '';
        customerForgotError.textContent = '';
        customerResetError.textContent = '';
        hideVerifyBox();
        $$('.customer-auth-tab').forEach(tab => {
            tab.style.display = '';
            tab.classList.toggle('active', tab.dataset.authMode === (loginMode ? 'login' : 'signup'));
        });
        customerAuthTitle.textContent = loginMode ? 'Access Your Account' : 'Create Your Account';
    }

    function openCustomerAuth(mode, introText) {
        if (mode === 'forgot') showForgotPasswordState();
        else if (mode === 'reset') showResetPasswordState();
        else setAuthMode(mode);
        customerLoginError.textContent = '';
        customerSignupError.textContent = '';
        customerAuthIntro.textContent = introText || 'Sign in or create an account to start building your cart.';
        hideVerifyBox();
        customerAuthOverlay.classList.add('open');
        document.body.style.overflow = 'hidden';
        const focusTarget = mode === 'signup'
            ? $('#customerSignupName')
            : mode === 'forgot'
                ? $('#customerForgotEmail')
                : mode === 'reset'
                    ? $('#customerResetPassword')
                    : $('#customerLoginEmail');
        if (focusTarget) window.setTimeout(() => focusTarget.focus(), 30);
    }

    function closeCustomerAuth() {
        customerAuthOverlay.classList.remove('open');
        document.body.style.overflow = productModal.classList.contains('open') ? 'hidden' : '';
    }

    async function syncCustomerFromSession() {
        if (!authReady()) {
            setCurrentCustomer(null);
            return;
        }
        const { data, error } = await supabaseClient.auth.getSession();
        if (error) {
            setCurrentCustomer(null);
            return;
        }
        const user = data && data.session && data.session.user;
        setCurrentCustomer(mapSupabaseUserToCustomer(user));
    }

    async function initializeCustomerAuth() {
        // Token-hash confirmation must run before anything else so the overlay
        // is shown immediately if the user landed from a confirmation email.
        console.log('[Auth Init] Starting customer auth initialization...');
        const isConfirmFlow = await handleTokenHashConfirmation();
        console.log('[Auth Init] Email confirm flow result:', isConfirmFlow);

        if (!authReady()) {
            console.log('[Auth Init] Auth not ready');
            setCurrentCustomer(null);
            if (!isConfirmFlow) handleAuthCallbackFeedback();
            return;
        }
        console.log('[Auth Init] Auth is ready, syncing session...');
        await syncCustomerFromSession();
        if (!isConfirmFlow) handleAuthCallbackFeedback();
        supabaseClient.auth.onAuthStateChange((_event, session) => {
            const user = session && session.user;
            setCurrentCustomer(mapSupabaseUserToCustomer(user));
        });
    }

    function handleCustomerAuthSuccess(customer, message) {
        setCurrentCustomer(customer);
        pendingVerificationEmail = '';
        exitVerificationState();
        hideVerifyBox();
        closeCustomerAuth();
        showToast(message, 'success');
        runPendingCartAction();
        if (cartView.style.display !== 'none') renderCart();
    }

    // Show / hide views
    function showStorefront() {
        storefrontView.style.display = '';
        adminView.style.display = 'none';
        cartView.style.display = 'none';
        customerSettingsView.style.display = 'none';
        siteFooter.style.display = '';
        renderProducts();
    }

    [
        ['openAuthBtn', 'login'],
        ['mobileAuthBtn', 'login'],
        ['cartAuthBtn', 'login'],
    ].forEach(([id, mode]) => {
        const button = $('#' + id);
        if (!button) return;
        button.addEventListener('click', () => openCustomerAuth(mode, 'Sign in or create an account to continue shopping on Keyzes.'));
    });

    [$('#customerLogoutBtn'), $('#mobileLogoutBtn')].forEach(button => {
        if (!button) return;
        button.addEventListener('click', async () => {
            if (authReady()) {
                await supabaseClient.auth.signOut();
            }
            setCurrentCustomer(null);
            showToast('You have been logged out.', 'info');
            if (cartView.style.display !== 'none') renderCart();
        });
    });

    $('#customerAuthClose').addEventListener('click', closeCustomerAuth);
    customerAuthOverlay.addEventListener('click', e => { if (e.target === customerAuthOverlay) closeCustomerAuth(); });

    $$('[data-password-toggle]').forEach(button => {
        button.addEventListener('click', () => {
            const target = document.getElementById(button.dataset.target || '');
            if (!target) return;
            const reveal = target.type === 'password';
            target.type = reveal ? 'text' : 'password';
            button.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
        });
    });

    customerResendVerifyBtn.addEventListener('click', async () => {
        if (!authReady()) {
            showToast('Supabase auth is not configured yet.', 'error');
            return;
        }
        if (!pendingVerificationEmail) {
            showToast('No email found to resend verification.', 'error');
            return;
        }

        customerResendVerifyBtn.disabled = true;
        customerVerifyStateResendBtn.disabled = true;
        const { error } = await supabaseClient.auth.resend({
            type: 'signup',
            email: pendingVerificationEmail,
            options: { emailRedirectTo: getAuthRedirectUrl() },
        });
        customerResendVerifyBtn.disabled = false;
        customerVerifyStateResendBtn.disabled = false;

        if (error) {
            showToast('Could not resend verification email. ' + error.message, 'error');
            return;
        }
        showVerifyBox('Verification email sent again to ' + pendingVerificationEmail + '. Check your inbox or spam folder.', pendingVerificationEmail);
        if (customerVerifyState.style.display !== 'none') {
            customerVerifyStateText.textContent = 'Verification email resent to ' + pendingVerificationEmail + '. After confirming, return and log in.';
        }
    });

    customerVerifyStateResendBtn.addEventListener('click', () => customerResendVerifyBtn.click());
    customerVerifyBackToLoginBtn.addEventListener('click', () => {
        setAuthMode('login');
        customerLoginError.textContent = '';
        customerLoginEmail.value = pendingVerificationEmail || customerLoginEmail.value;
        customerLoginEmail.focus();
    });

    $$('.customer-auth-tab').forEach(tab => {
        tab.addEventListener('click', () => setAuthMode(tab.dataset.authMode));
    });

    customerForgotPasswordBtn.addEventListener('click', () => {
        const fallbackEmail = currentCustomer ? currentCustomer.email : '';
        customerForgotEmail.value = normalizeEmail(customerLoginEmail.value || fallbackEmail || '');
        openCustomerAuth('forgot');
    });

    customerForgotBackBtn.addEventListener('click', () => {
        setAuthMode('login');
        customerLoginEmail.focus();
    });

    customerForgotForm.addEventListener('submit', async e => {
        e.preventDefault();
        if (!authReady()) {
            customerForgotError.textContent = 'Supabase auth is not configured yet.';
            return;
        }

        const email = normalizeEmail(customerForgotEmail.value);
        if (!email || !isValidEmail(email)) {
            customerForgotError.textContent = 'Enter a valid email address.';
            return;
        }

        customerForgotError.textContent = '';
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
            redirectTo: getAuthRedirectUrl(),
        });

        if (error) {
            customerForgotError.textContent = error.message || 'Could not send reset email.';
            return;
        }

        showToast('Password reset email sent. Check your inbox.', 'info');
        setAuthMode('login');
        customerLoginEmail.value = email;
    });

    customerResetForm.addEventListener('submit', async e => {
        e.preventDefault();
        if (!authReady()) {
            customerResetError.textContent = 'Supabase auth is not configured yet.';
            return;
        }

        const password = customerResetPassword.value;
        const confirmPassword = customerResetPasswordConfirm.value;
        if (password.length < 6) {
            customerResetError.textContent = 'Use at least 6 characters.';
            return;
        }
        if (password !== confirmPassword) {
            customerResetError.textContent = 'Passwords do not match.';
            return;
        }

        customerResetError.textContent = '';
        const { error } = await supabaseClient.auth.updateUser({ password });
        if (error) {
            customerResetError.textContent = error.message || 'Could not update password.';
            return;
        }

        customerResetForm.reset();
        setAuthMode('login');
        showToast('Password updated. Log in with your new password.', 'success');
    });

    customerLoginForm.addEventListener('submit', e => {
        e.preventDefault();
        if (!authReady()) {
            customerLoginError.textContent = 'Supabase auth is not configured yet.';
            return;
        }
        if (!validateLoginFields()) {
            customerLoginError.textContent = 'Please fix the highlighted fields.';
            return;
        }
        const email = normalizeEmail(customerLoginEmail.value);
        const password = customerLoginPassword.value;

        customerLoginError.textContent = '';
        hideVerifyBox();

        supabaseClient.auth.signInWithPassword({ email, password }).then(({ data, error }) => {
            if (error) {
                const msg = (error.message || '').toLowerCase();
                if (msg.includes('not confirmed') || msg.includes('email_not_confirmed')) {
                    customerLoginError.textContent = 'Your email is not verified yet.';
                    showVerifyBox('Please verify your email before logging in. If needed, resend the verification email.', email);
                    return;
                }
                customerLoginError.textContent = error.message || 'Login failed.';
                return;
            }

            const user = data && data.user;
            if (!user) {
                customerLoginError.textContent = 'Login failed.';
                return;
            }

            pendingVerificationEmail = '';
            customerLoginError.textContent = '';
            clearInlineErrors(customerLoginForm);
            customerLoginForm.reset();
            handleCustomerAuthSuccess(mapSupabaseUserToCustomer(user), 'Welcome back. You are now logged in.');
        });
    });

    customerSignupForm.addEventListener('submit', e => {
        e.preventDefault();
        if (!authReady()) {
            customerSignupError.textContent = 'Supabase auth is not configured yet.';
            return;
        }
        if (!validateSignupFields()) {
            customerSignupError.textContent = 'Please fix the highlighted fields.';
            return;
        }
        const name = customerSignupName.value.trim();
        const email = normalizeEmail(customerSignupEmail.value);
        const password = customerSignupPassword.value;

        customerSignupError.textContent = '';
        hideVerifyBox();

        supabaseClient.auth.signUp({
            email,
            password,
            options: {
                data: { full_name: name },
                emailRedirectTo: getAuthRedirectUrl(),
            },
        }).then(({ data, error }) => {
            if (error) {
                customerSignupError.textContent = error.message || 'Signup failed.';
                return;
            }

            const user = data && data.user;
            const hasSession = !!(data && data.session);
            if (!user) {
                customerSignupError.textContent = 'Signup failed.';
                return;
            }

            if (!hasSession) {
                pendingVerificationEmail = email;
                showVerifyBox('Account created. Verify your email to activate login, then return here and sign in.', email);
                enterVerificationState(email);
                customerSignupError.textContent = '';
                clearInlineErrors(customerSignupForm);
                showToast('Account created. Check your email to verify your account.', 'info');
                return;
            }

            pendingVerificationEmail = '';
            customerSignupError.textContent = '';
            clearInlineErrors(customerSignupForm);
            customerSignupForm.reset();
            handleCustomerAuthSuccess(mapSupabaseUserToCustomer(user), 'Account created successfully.');
        });
    });

    [customerLoginEmail, customerLoginPassword].forEach(input => {
        input.addEventListener('input', () => {
            validateLoginFields();
            if (customerLoginError.textContent === 'Please fix the highlighted fields.') {
                customerLoginError.textContent = '';
            }
        });
    });

    [customerSignupName, customerSignupEmail, customerSignupPassword, customerSignupConfirm].forEach(input => {
        input.addEventListener('input', () => {
            validateSignupFields();
            if (customerSignupError.textContent === 'Please fix the highlighted fields.') {
                customerSignupError.textContent = '';
            }
        });
    });

    function showCart() {
        storefrontView.style.display = 'none';
        adminView.style.display = 'none';
        customerSettingsView.style.display = 'none';
        cartView.style.display = '';
        siteFooter.style.display = '';
        renderCart();
    }

    function showAccountSection(section) {
        const safeSection = section || 'overview';
        accountSideLinks.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.accountNav === safeSection);
        });
        accountPanes.forEach(pane => {
            pane.classList.toggle('active', pane.dataset.accountPane === safeSection);
        });
    }

    function showCustomerSettings() {
        if (!currentCustomer) {
            openCustomerAuth('login', 'Log in to access your account settings.');
            return;
        }
        if (isCurrentUserAdmin()) {
            showAdmin();
            return;
        }

        storefrontView.style.display = 'none';
        adminView.style.display = 'none';
        cartView.style.display = 'none';
        customerSettingsView.style.display = '';
        siteFooter.style.display = '';
        customerProfileNameInput.value = currentCustomer.name || '';
        customerProfileEmailInput.value = currentCustomer.email || '';
        customerProfileError.textContent = '';
        customerProfileForm.querySelectorAll('button[type="submit"]').forEach(b => { b.textContent = 'Save Changes'; b.disabled = false; });
        customerPasswordForm.reset();
        customerPasswordError.textContent = '';
        if (affiliateActionMsg) affiliateActionMsg.textContent = '';
        showAccountSection('overview');
        renderAccountProgramPanels();
        customerDeleteHelp.textContent = isDeleteAccountConfigured()
            ? 'Delete request will be processed immediately.'
            : 'Account deletion endpoint is not configured yet. Contact support to complete account removal.';
    }

    function showAdmin() {
        if (!currentCustomer) {
            openCustomerAuth('login', 'Sign in with the admin account to open the admin panel.');
            return;
        }
        if (!isCurrentUserAdmin()) {
            showToast('Admin access is restricted to ' + ADMIN_EMAIL + '.', 'error');
            return;
        }
        storefrontView.style.display = 'none';
        adminView.style.display = '';
        cartView.style.display = 'none';
        customerSettingsView.style.display = 'none';
        siteFooter.style.display = 'none';
        showAdminSection('dashboard');
    }

    // Admin trigger (gear icon / nav link)
    $('#adminTrigger').addEventListener('click', e => { e.preventDefault(); showAdmin(); });

    // Mobile nav links
    $$('.mobile-nav-link, .nav-link[data-nav]').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            const nav = link.dataset.nav;
            if (nav === 'admin') { showAdmin(); }
            else if (nav === 'account') { showCustomerSettings(); }
            else if (nav === 'cart') { showCart(); }
            else { showStorefront(); }
            mobileMenuBtn.classList.remove('active');
            mobileNav.classList.remove('open');
        });
    });

    // Logo goes to store
    $('#logoHome').addEventListener('click', e => { e.preventDefault(); showStorefront(); });

    // Admin logout
    $('#adminLogout').addEventListener('click', async e => {
        e.preventDefault();
        if (authReady()) await supabaseClient.auth.signOut();
        setCurrentCustomer(null);
        showStorefront();
        showToast('Signed out successfully.', 'info');
    });

    // Back to store
    $('#adminBackToStore').addEventListener('click', e => { e.preventDefault(); showStorefront(); });
    const adminMobileBack = $('#adminMobileBack');
    if (adminMobileBack) adminMobileBack.addEventListener('click', () => showStorefront());
    if (settingsBackBtn) settingsBackBtn.addEventListener('click', () => showStorefront());
    if (customerAccountBtn) customerAccountBtn.addEventListener('click', () => showCustomerSettings());
    if (mobileCustomerAccountBtn) mobileCustomerAccountBtn.addEventListener('click', () => {
        showCustomerSettings();
        mobileMenuBtn.classList.remove('active');
        mobileNav.classList.remove('open');
    });
    accountSideLinks.forEach(button => {
        button.addEventListener('click', () => showAccountSection(button.dataset.accountNav));
    });

    if (customerProfileAvatarFile) {
        customerProfileAvatarFile.addEventListener('change', () => {
            if (!currentCustomer) return;
            const file = customerProfileAvatarFile.files && customerProfileAvatarFile.files[0];
            if (!file) return;
            if (!file.type.startsWith('image/')) {
                showToast('Please select an image file.', 'error');
                return;
            }
            if (file.size > 4 * 1024 * 1024) {
                showToast('Image too large. Max 4MB.', 'error');
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                const profile = getCustomerProfile(currentCustomer.email, true);
                profile.avatar = String(reader.result || '');
                saveCustomerProgramState();
                if (customerProfileAvatarHelp) customerProfileAvatarHelp.textContent = 'Profile photo updated.';
                renderAccountProgramPanels();
            };
            reader.readAsDataURL(file);
        });
    }

    if (affiliateCreateBtn) {
        affiliateCreateBtn.addEventListener('click', () => {
            if (!currentCustomer) {
                showToast('Please log in first.', 'error');
                return;
            }
            const profile = getCustomerProfile(currentCustomer.email, true);
            let code = cleanAffiliateCode(affiliateCodeInput ? affiliateCodeInput.value : '');
            if (!code) {
                code = generateAffiliateCode(currentCustomer.name || 'KEYZES');
            }
            if (!profile.affiliateCode && affiliateCodes[code] && affiliateCodes[code] !== normalizeEmail(currentCustomer.email)) {
                showToast('Affiliate code already taken. Try another.', 'error');
                return;
            }

            if (profile.affiliateCode && profile.affiliateCode !== code) {
                delete affiliateCodes[profile.affiliateCode];
            }
            profile.affiliateCode = code;
            affiliateCodes[code] = normalizeEmail(currentCustomer.email);
            saveCustomerProgramState();
            if (affiliateCodeInput) affiliateCodeInput.value = code;
            renderAccountProgramPanels();
            showToast('Affiliate code saved: ' + code, 'success');
        });
    }

    if (affiliateCopyBtn) {
        affiliateCopyBtn.addEventListener('click', async () => {
            if (!currentCustomer) return;
            const profile = getCustomerProfile(currentCustomer.email, true);
            if (!profile.affiliateCode) {
                showToast('Create your affiliate code first.', 'error');
                return;
            }
            const link = window.location.origin + window.location.pathname + '?ref=' + profile.affiliateCode;
            try {
                await navigator.clipboard.writeText(link);
                showToast('Affiliate link copied.', 'success');
            } catch {
                showToast('Copy failed. Link: ' + link, 'info');
            }
        });
    }

    if (affiliateWithdrawEmailBtn) {
        affiliateWithdrawEmailBtn.addEventListener('click', () => {
            if (!currentCustomer) return;
            const profile = getCustomerProfile(currentCustomer.email, true);
            if (Number(profile.affiliateBalance || 0) < 1) {
                if (affiliateActionMsg) affiliateActionMsg.textContent = 'Cashout becomes available when affiliate balance reaches at least 1.00 EUR.';
                return;
            }
            if (affiliateActionMsg) affiliateActionMsg.textContent = 'For cashout contact keyzes.store@gmail.com with your account email and requested amount.';
        });
    }

    if (affiliateTransferCreditBtn) {
        affiliateTransferCreditBtn.addEventListener('click', () => {
            if (!currentCustomer) return;
            const profile = getCustomerProfile(currentCustomer.email, true);
            const amount = Number(profile.affiliateBalance || 0);
            if (amount <= 0) {
                if (affiliateActionMsg) affiliateActionMsg.textContent = 'No affiliate balance available to transfer.';
                return;
            }
            profile.storeCredit = Number(profile.storeCredit || 0) + amount;
            profile.affiliateBalance = 0;
            saveCustomerProgramState();
            if (affiliateActionMsg) affiliateActionMsg.textContent = 'Transferred ' + formatMoney(amount) + ' EUR to store credit. This amount is no longer cashout eligible.';
            renderAccountProgramPanels();
        });
    }

    if (storeCreditTopupBtn) {
        storeCreditTopupBtn.addEventListener('click', () => {
            showToast('Top up provider is coming soon. Use affiliate transfer for now.', 'info');
        });
    }

    customerProfileForm.addEventListener('submit', async e => {
        e.preventDefault();
        if (!authReady() || !currentCustomer) {
            customerProfileError.textContent = 'Please log in first.';
            return;
        }

        const newName = customerProfileNameInput.value.trim();
        const newEmail = customerProfileEmailInput.value.trim();
        if (!newName) {
            customerProfileError.textContent = 'Name cannot be empty.';
            return;
        }
        if (!newEmail) {
            customerProfileError.textContent = 'Email cannot be empty.';
            return;
        }

        customerProfileError.textContent = '';
        const submitBtn = customerProfileForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Saving…';

        const updates = {};
        if (newName !== currentCustomer.name) updates.data = { full_name: newName };
        if (newEmail !== currentCustomer.email) updates.email = newEmail;

        if (!updates.data && !updates.email) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Save Changes';
            showToast('No changes to save.', 'info');
            return;
        }

        const { data, error } = await supabaseClient.auth.updateUser(updates);

        submitBtn.disabled = false;
        submitBtn.textContent = 'Save Changes';

        if (error) {
            customerProfileError.textContent = error.message || 'Could not save changes.';
            return;
        }

        if (data && data.user) {
            setCurrentCustomer(mapSupabaseUserToCustomer(data.user));
        } else {
            setCurrentCustomer({
                id: currentCustomer.id,
                name: newName,
                email: newEmail,
            });
        }

        if (updates.email) {
            showToast('Check your new email address to confirm the change.', 'info');
        } else {
            showToast('Profile updated successfully.', 'success');
        }
    });

    customerPasswordForm.addEventListener('submit', async e => {
        e.preventDefault();
        if (!authReady() || !currentCustomer) {
            customerPasswordError.textContent = 'Please log in first.';
            return;
        }

        const password = customerNewPassword.value;
        const confirmPassword = customerNewPasswordConfirm.value;
        if (password.length < 6) {
            customerPasswordError.textContent = 'Use at least 6 characters.';
            return;
        }
        if (password !== confirmPassword) {
            customerPasswordError.textContent = 'Passwords do not match.';
            return;
        }

        customerPasswordError.textContent = '';
        const { error } = await supabaseClient.auth.updateUser({ password });
        if (error) {
            customerPasswordError.textContent = error.message || 'Could not update password.';
            return;
        }

        customerPasswordForm.reset();
        showToast('Password updated successfully.', 'success');
    });

    customerDeleteAccountBtn.addEventListener('click', () => {
        if (!currentCustomer) {
            showToast('Please log in first.', 'error');
            return;
        }

        showConfirm(
            'Delete Account?',
            'This action permanently removes your account and cannot be undone.',
            async () => {
                if (!isDeleteAccountConfigured()) {
                    showToast('Delete endpoint is not configured yet.', 'error');
                    return;
                }
                if (!authReady()) {
                    showToast('Supabase auth is not configured yet.', 'error');
                    return;
                }

                const sessionResult = await supabaseClient.auth.getSession();
                const session = sessionResult && sessionResult.data && sessionResult.data.session;
                if (!session || !session.access_token) {
                    showToast('Your session expired. Please log in again.', 'error');
                    return;
                }

                try {
                    const response = await fetch(APP_CONFIG.accountDeleteFunctionUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'apikey': APP_CONFIG.supabaseAnonKey,
                            Authorization: 'Bearer ' + session.access_token,
                        },
                        body: JSON.stringify({ reason: 'self-service-delete' }),
                    });

                    if (!response.ok) {
                        const message = await response.text();
                        showToast('Could not delete account. ' + (message || 'Try again later.'), 'error');
                        return;
                    }

                    await supabaseClient.auth.signOut();
                    setCurrentCustomer(null);
                    showStorefront();
                    showToast('Your account has been deleted.', 'success');
                } catch {
                    showToast('Could not delete account right now. Try again later.', 'error');
                }
            }
        );
    });

    // Admin sidebar nav
    $$('.admin-nav-item[data-section]').forEach(item => {
        item.addEventListener('click', e => {
            e.preventDefault();
            showAdminSection(item.dataset.section);
            // close mobile sidebar
            $('#adminSidebar').classList.remove('open');
            $('#adminSidebarOverlay').classList.remove('open');
        });
    });

    // Go to add product from products list
    $('#goToAddProduct').addEventListener('click', () => showAdminSection('add-product'));

    // Mobile admin sidebar toggle
    const adminMobileSidebarBtn = $('#adminMobileSidebarBtn');
    const adminSidebar = $('#adminSidebar');
    const adminSidebarOverlay = $('#adminSidebarOverlay');

    if (adminMobileSidebarBtn) {
        adminMobileSidebarBtn.addEventListener('click', () => {
            adminSidebar.classList.toggle('open');
            adminSidebarOverlay.classList.toggle('open');
        });
    }
    if (adminSidebarOverlay) {
        adminSidebarOverlay.addEventListener('click', () => {
            adminSidebar.classList.remove('open');
            adminSidebarOverlay.classList.remove('open');
        });
    }

    function showAdminSection(section) {
        const sections = { dashboard: 'adminDashboard', products: 'adminProducts', 'add-product': 'adminAddProduct', settings: 'adminSettings' };
        Object.values(sections).forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        const target = document.getElementById(sections[section]);
        if (target) target.style.display = '';

        // Active nav
        $$('.admin-nav-item').forEach(n => n.classList.remove('active'));
        const navItem = $(`.admin-nav-item[data-section="${section}"]`);
        if (navItem) navItem.classList.add('active');

        // Populate section data
        if (section === 'dashboard') renderDashboard();
        if (section === 'products') renderAdminProducts();
        if (section === 'add-product') resetProductForm();
        if (section === 'settings') populateSettings();
    }

    // ---- Dashboard ----
    function renderDashboard() {
        $('#statProducts').textContent = products.length;
        const cats = new Set(products.map(p => p.category));
        $('#statCategories').textContent = cats.size;
        const avg = products.length ? (products.reduce((s, p) => s + p.price, 0) / products.length).toFixed(2) : '0';
        $('#statAvgPrice').textContent = '$' + avg;
        const onSale = products.filter(p => p.badge === 'sale' || p.originalPrice).length;
        $('#statOnSale').textContent = onSale;

        // Recent 5 products
        const recent = [...products].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5);
        const tbody = $('#dashboardRecentProducts');
        if (recent.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:24px;">No products yet.</td></tr>';
            return;
        }
        tbody.innerHTML = recent.map(p => `
            <tr>
                <td><strong style="color:var(--text-primary)">${escapeHtml(p.title)}</strong></td>
                <td>${categoryLabel(p.category)}</td>
                <td style="color:var(--orange-light)">$${p.price.toFixed(2)}</td>
                <td>${platformLabel(p.platform)}</td>
                <td class="table-actions">
                    <button class="table-btn table-btn-edit" data-edit="${p.id}">Edit</button>
                    <button class="table-btn table-btn-delete" data-delete="${p.id}">Delete</button>
                </td>
            </tr>
        `).join('');
    }

    // ---- Admin Products List ----
    function renderAdminProducts() {
        let list = [...products];
        const searchVal = $('#adminSearchProducts').value.trim().toLowerCase();
        const catVal = $('#adminFilterCategory').value;
        if (searchVal) list = list.filter(p => p.title.toLowerCase().includes(searchVal));
        if (catVal) list = list.filter(p => p.category === catVal);

        list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        const tbody = $('#adminProductsTable');
        const emptyEl = $('#adminProductsEmpty');

        if (list.length === 0) {
            tbody.innerHTML = '';
            emptyEl.style.display = '';
            return;
        }
        emptyEl.style.display = 'none';

        tbody.innerHTML = list.map(p => {
            const badgeHtml = p.badge ? `<span class="table-badge table-badge-${p.badge}">${p.badge}</span>` : '<span style="color:var(--text-muted)">-</span>';
            const salePrice = p.originalPrice ? `<span style="text-decoration:line-through;color:var(--text-muted);margin-left:6px;">$${p.originalPrice.toFixed(2)}</span>` : '';
            const imgSrc = p.image || '';
            const imgHtml = imgSrc ? `<img src="${escapeAttr(imgSrc)}" class="table-product-img" onerror="this.style.display='none'">` : '<span style="color:var(--text-muted)">-</span>';
            return `
            <tr>
                <td>${imgHtml}</td>
                <td><strong style="color:var(--text-primary)">${escapeHtml(p.title)}</strong></td>
                <td>${categoryLabel(p.category)}</td>
                <td>${platformLabel(p.platform)}</td>
                <td style="color:var(--orange-light)">$${p.price.toFixed(2)}${salePrice}</td>
                <td>${p.originalPrice ? 'Yes' : '-'}</td>
                <td>${badgeHtml}</td>
                <td>${p.warranty ? escapeHtml(p.warranty) : '<span style="color:var(--text-muted)">-</span>'}</td>
                <td class="table-actions">
                    <button class="table-btn table-btn-edit" data-edit="${p.id}">Edit</button>
                    <button class="table-btn table-btn-delete" data-delete="${p.id}">Delete</button>
                </td>
            </tr>`;
        }).join('');
    }

    // Admin search & filter
    const adminSearchProducts = $('#adminSearchProducts');
    const adminFilterCategory = $('#adminFilterCategory');

    if (adminSearchProducts) adminSearchProducts.addEventListener('input', renderAdminProducts);
    if (adminFilterCategory) adminFilterCategory.addEventListener('change', renderAdminProducts);

    // ---- Product Form (Add / Edit) ----
    const productForm = $('#productForm');
    const productEditId = $('#productEditId');

    function resetProductForm() {
        productForm.reset();
        productEditId.value = '';
        $('#productFormTitle').textContent = 'Add New Product';
        $('#submitProductBtn').textContent = 'Add Product';
        $('#imagePreview').innerHTML = '';
        $('#productRating').value = '4.5';
        $('#productReviews').value = '0';
        $('#productWarranty').value = '';
        $('#productImageData').value = '';
        if ($('#productImageFile')) $('#productImageFile').value = '';
        clearVariantRows();
        addVariantRow('', '');
    }

    function populateProductForm(product) {
        productEditId.value = product.id;
        $('#productFormTitle').textContent = 'Edit Product';
        $('#submitProductBtn').textContent = 'Save Changes';
        $('#productTitle').value = product.title;
        $('#productCategory').value = product.category;
        $('#productPlatform').value = product.platform;
        $('#productBadge').value = product.badge || '';
        $('#productRating').value = product.rating;
        $('#productReviews').value = product.reviews;
        $('#productDescription').value = product.description || '';
        const imgVal = product.image || '';
        if (imgVal.startsWith('data:')) {
            $('#productImage').value = '';
            $('#productImageData').value = imgVal;
        } else {
            $('#productImage').value = imgVal;
            $('#productImageData').value = '';
        }
        $('#productFeatured').checked = !!product.featured;
        $('#productWarranty').value = product.warranty || '';
        if (imgVal) {
            $('#imagePreview').innerHTML = '<img src="' + escapeAttr(imgVal) + '" alt="Preview">';
        } else {
            $('#imagePreview').innerHTML = '';
        }
        clearVariantRows();
        if (product.variants && product.variants.length > 0) {
            product.variants.forEach(v => addVariantRow(v.name, v.price, v.originalPrice));
        } else {
            addVariantRow('', '', '');
        }
    }

    // Variant rows management
    function clearVariantRows() {
        $('#variantsList').innerHTML = '';
    }

    function addVariantRow(name, price, originalPrice) {
        const row = document.createElement('div');
        row.className = 'variant-row';
        row.innerHTML = `
            <input type="text" class="variant-name" placeholder="Option name" value="${escapeAttr(String(name || ''))}">
            <input type="number" class="variant-price" placeholder="Price" step="0.01" min="0" value="${price || ''}">
            <input type="number" class="variant-original-price" placeholder="Original price" step="0.01" min="0" value="${originalPrice || ''}">
            <button type="button" class="variant-remove-btn">&times;</button>
        `;
        row.querySelector('.variant-remove-btn').addEventListener('click', () => {
            row.remove();
        });
        $('#variantsList').appendChild(row);
    }

    $('#addVariantBtn').addEventListener('click', () => addVariantRow('', '', ''));

    function getVariantsFromForm() {
        const rows = $$('#variantsList .variant-row');
        const variants = [];
        rows.forEach(row => {
            const name = row.querySelector('.variant-name').value.trim();
            const price = parseFloat(row.querySelector('.variant-price').value);
            const origPrice = row.querySelector('.variant-original-price').value ? parseFloat(row.querySelector('.variant-original-price').value) : null;
            if (name && !isNaN(price) && price >= 0) {
                variants.push({ name, price, originalPrice: origPrice });
            }
        });
        return variants;
    }

    // ---- Image Cropper ----
    const productImageInput = $('#productImage');
    const CROP_RATIO = 16 / 10;
    const CROP_HANDLE = 10;
    let cropperImg = null;
    let cropRect = { x: 0, y: 0, w: 0, h: 0 };
    let cropDragging = false;
    let cropDragStart = {};
    let cropDragMode = 'move';
    let cropScale = 1;

    function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

    function updatePreviewFromResult(src) {
        $('#imagePreview').innerHTML = '<img src="' + escapeAttr(src) + '" alt="Preview">';
    }

    // File upload handler
    $('#productImageFile').addEventListener('change', function() {
        const file = this.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) { showToast('Please select an image file.', 'error'); return; }
        if (file.size > 5 * 1024 * 1024) { showToast('Image too large. Max 5 MB.', 'error'); return; }
        const reader = new FileReader();
        reader.onload = function(e) { loadImageIntoCropper(e.target.result); };
        reader.readAsDataURL(file);
        productImageInput.value = '';
    });

    // URL input handler (debounced)
    let imgUrlTimer = null;
    productImageInput.addEventListener('input', function() {
        clearTimeout(imgUrlTimer);
        const val = this.value.trim();
        if (!val) {
            $('#imagePreview').innerHTML = '';
            $('#productImageData').value = '';
            return;
        }
        $('#imagePreview').innerHTML = '<span style="color:var(--text-muted);font-size:12px">Loading...</span>';
        imgUrlTimer = setTimeout(function() { loadImageIntoCropper(val); }, 600);
    });

    function loadImageIntoCropper(src) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function() { cropperImg = img; openCropper(); };
        img.onerror = function() {
            if (img.crossOrigin) {
                const img2 = new Image();
                img2.onload = function() { img2._corsFailed = true; cropperImg = img2; openCropper(); };
                img2.onerror = function() {
                    showToast('Could not load image.', 'error');
                    $('#imagePreview').innerHTML = '<span style="color:#e74c3c;font-size:12px">Invalid image</span>';
                };
                img2.src = src;
            } else {
                showToast('Could not load image.', 'error');
                $('#imagePreview').innerHTML = '';
            }
        };
        img.src = src;
    }

    function openCropper() {
        const canvas = $('#cropperCanvas');
        const maxW = Math.min(672, window.innerWidth - 80);
        const maxH = Math.min(window.innerHeight * 0.55, 500);
        const imgW = cropperImg.naturalWidth;
        const imgH = cropperImg.naturalHeight;
        cropScale = Math.min(maxW / imgW, maxH / imgH, 1);
        canvas.width = Math.round(imgW * cropScale);
        canvas.height = Math.round(imgH * cropScale);
        initCropRect(imgW, imgH);
        $('#cropperOverlay').classList.add('open');
        drawCropper();
    }

    function initCropRect(imgW, imgH) {
        let cw = imgW, ch = cw / CROP_RATIO;
        if (ch > imgH) { ch = imgH; cw = ch * CROP_RATIO; }
        cropRect = {
            x: Math.round((imgW - cw) / 2),
            y: Math.round((imgH - ch) / 2),
            w: Math.round(cw),
            h: Math.round(ch)
        };
    }

    function drawCropper() {
        const canvas = $('#cropperCanvas');
        const ctx = canvas.getContext('2d');
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(cropperImg, 0, 0, w, h);

        const rx = cropRect.x * cropScale, ry = cropRect.y * cropScale;
        const rw = cropRect.w * cropScale, rh = cropRect.h * cropScale;

        // Dark overlay outside crop
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, 0, w, ry);
        ctx.fillRect(0, ry + rh, w, h - ry - rh);
        ctx.fillRect(0, ry, rx, rh);
        ctx.fillRect(rx + rw, ry, w - rx - rw, rh);

        // Crop border
        ctx.strokeStyle = '#f37920';
        ctx.lineWidth = 2;
        ctx.strokeRect(rx, ry, rw, rh);

        // Corner handles
        ctx.fillStyle = '#f37920';
        const hs = CROP_HANDLE;
        ctx.fillRect(rx, ry, hs, hs);
        ctx.fillRect(rx + rw - hs, ry, hs, hs);
        ctx.fillRect(rx, ry + rh - hs, hs, hs);
        ctx.fillRect(rx + rw - hs, ry + rh - hs, hs, hs);

        // Rule of thirds
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1;
        for (let i = 1; i <= 2; i++) {
            const lx = rx + rw * i / 3;
            ctx.beginPath(); ctx.moveTo(lx, ry); ctx.lineTo(lx, ry + rh); ctx.stroke();
            const ly = ry + rh * i / 3;
            ctx.beginPath(); ctx.moveTo(rx, ly); ctx.lineTo(rx + rw, ly); ctx.stroke();
        }
    }

    // Cropper mouse/touch interaction
    (function() {
        const canvas = document.getElementById('cropperCanvas');
        function getPos(e) {
            const r = canvas.getBoundingClientRect();
            const cx = e.touches ? e.touches[0].clientX : e.clientX;
            const cy = e.touches ? e.touches[0].clientY : e.clientY;
            return { x: (cx - r.left) / cropScale, y: (cy - r.top) / cropScale };
        }
        function inHandle(p, hx, hy) {
            const s = CROP_HANDLE / cropScale;
            return p.x >= hx && p.x <= hx + s && p.y >= hy && p.y <= hy + s;
        }
        function inRect(p) {
            return p.x >= cropRect.x && p.x <= cropRect.x + cropRect.w &&
                   p.y >= cropRect.y && p.y <= cropRect.y + cropRect.h;
        }
        function getMode(p) {
            const s = CROP_HANDLE / cropScale;
            if (inHandle(p, cropRect.x + cropRect.w - s, cropRect.y + cropRect.h - s)) return 'resize-br';
            if (inHandle(p, cropRect.x, cropRect.y)) return 'resize-tl';
            if (inHandle(p, cropRect.x + cropRect.w - s, cropRect.y)) return 'resize-tr';
            if (inHandle(p, cropRect.x, cropRect.y + cropRect.h - s)) return 'resize-bl';
            if (inRect(p)) return 'move';
            return null;
        }
        function onDown(e) {
            e.preventDefault();
            const p = getPos(e);
            const mode = getMode(p);
            if (!mode) return;
            cropDragMode = mode;
            cropDragging = true;
            cropDragStart = { mx: p.x, my: p.y, rx: cropRect.x, ry: cropRect.y, rw: cropRect.w, rh: cropRect.h };
        }
        function onMove(e) {
            if (!cropDragging) {
                const p = getPos(e);
                const m = getMode(p);
                canvas.style.cursor = m === 'move' ? 'grab' :
                    (m === 'resize-br' || m === 'resize-tl') ? 'nwse-resize' :
                    (m === 'resize-tr' || m === 'resize-bl') ? 'nesw-resize' : 'crosshair';
                return;
            }
            e.preventDefault();
            const p = getPos(e);
            const dx = p.x - cropDragStart.mx, dy = p.y - cropDragStart.my;
            const imgW = cropperImg.naturalWidth, imgH = cropperImg.naturalHeight;
            const s = cropDragStart;

            if (cropDragMode === 'move') {
                cropRect.x = clamp(s.rx + dx, 0, imgW - cropRect.w);
                cropRect.y = clamp(s.ry + dy, 0, imgH - cropRect.h);
            } else if (cropDragMode === 'resize-br') {
                let nw = Math.max(80, s.rw + dx);
                let nh = nw / CROP_RATIO;
                if (s.rx + nw > imgW) { nw = imgW - s.rx; nh = nw / CROP_RATIO; }
                if (s.ry + nh > imgH) { nh = imgH - s.ry; nw = nh * CROP_RATIO; }
                cropRect.w = Math.round(nw); cropRect.h = Math.round(nh);
            } else if (cropDragMode === 'resize-tl') {
                let nw = Math.max(80, s.rw - dx);
                let nh = nw / CROP_RATIO;
                let nx = s.rx + s.rw - nw, ny = s.ry + s.rh - nh;
                if (nx < 0) { nx = 0; nw = s.rx + s.rw; nh = nw / CROP_RATIO; ny = s.ry + s.rh - nh; }
                if (ny < 0) { ny = 0; nh = s.ry + s.rh; nw = nh * CROP_RATIO; nx = s.rx + s.rw - nw; }
                cropRect = { x: Math.round(nx), y: Math.round(ny), w: Math.round(nw), h: Math.round(nh) };
            } else if (cropDragMode === 'resize-tr') {
                let nw = Math.max(80, s.rw + dx);
                let nh = nw / CROP_RATIO;
                let ny = s.ry + s.rh - nh;
                if (s.rx + nw > imgW) { nw = imgW - s.rx; nh = nw / CROP_RATIO; ny = s.ry + s.rh - nh; }
                if (ny < 0) { ny = 0; nh = s.ry + s.rh; nw = nh * CROP_RATIO; }
                cropRect = { x: cropRect.x, y: Math.round(ny), w: Math.round(nw), h: Math.round(nh) };
            } else if (cropDragMode === 'resize-bl') {
                let nw = Math.max(80, s.rw - dx);
                let nh = nw / CROP_RATIO;
                let nx = s.rx + s.rw - nw;
                if (nx < 0) { nx = 0; nw = s.rx + s.rw; nh = nw / CROP_RATIO; }
                if (s.ry + nh > imgH) { nh = imgH - s.ry; nw = nh * CROP_RATIO; nx = s.rx + s.rw - nw; }
                cropRect = { x: Math.round(nx), y: cropRect.y, w: Math.round(nw), h: Math.round(nh) };
            }
            drawCropper();
        }
        function onUp() { cropDragging = false; }
        canvas.addEventListener('mousedown', onDown);
        canvas.addEventListener('mousemove', onMove);
        canvas.addEventListener('mouseup', onUp);
        canvas.addEventListener('mouseleave', onUp);
        canvas.addEventListener('touchstart', onDown, { passive: false });
        canvas.addEventListener('touchmove', onMove, { passive: false });
        canvas.addEventListener('touchend', onUp);
    })();

    function closeCropper() {
        $('#cropperOverlay').classList.remove('open');
        cropperImg = null;
        if ($('#productImageFile')) $('#productImageFile').value = '';
    }

    $('#cropperConfirm').addEventListener('click', function() {
        if (!cropperImg) return;
        if (cropperImg._corsFailed) {
            const url = productImageInput.value.trim();
            $('#productImageData').value = url;
            updatePreviewFromResult(url);
            showToast('CORS blocked cropping. Original URL used as-is.', 'info');
            closeCropper();
            return;
        }
        const outCanvas = document.createElement('canvas');
        let outW = Math.min(cropRect.w, 640);
        let outH = Math.round(outW / CROP_RATIO);
        outCanvas.width = outW; outCanvas.height = outH;
        const ctx = outCanvas.getContext('2d');
        ctx.drawImage(cropperImg, cropRect.x, cropRect.y, cropRect.w, cropRect.h, 0, 0, outW, outH);
        let dataUri = outCanvas.toDataURL('image/jpeg', 0.8);
        if (dataUri.length > 500000) {
            outCanvas.width = 480; outCanvas.height = Math.round(480 / CROP_RATIO);
            outCanvas.getContext('2d').drawImage(cropperImg, cropRect.x, cropRect.y, cropRect.w, cropRect.h, 0, 0, 480, outCanvas.height);
            dataUri = outCanvas.toDataURL('image/jpeg', 0.65);
        }
        $('#productImageData').value = dataUri;
        updatePreviewFromResult(dataUri);
        showToast('Image cropped successfully.', 'success');
        closeCropper();
    });

    $('#cropperCancel').addEventListener('click', closeCropper);
    $('#cropperOverlay').addEventListener('click', function(e) { if (e.target === this) closeCropper(); });

    // Submit product form
    productForm.addEventListener('submit', e => {
        e.preventDefault();

        const variants = getVariantsFromForm();
        if (variants.length === 0) {
            showToast('Add at least one price variant.', 'error');
            return;
        }

        const data = {
            title: $('#productTitle').value.trim(),
            category: $('#productCategory').value,
            platform: $('#productPlatform').value,
            badge: $('#productBadge').value || null,
            price: Math.min(...variants.map(v => v.price)),
            originalPrice: variants[0].originalPrice || null,
            rating: parseFloat($('#productRating').value) || 0,
            reviews: parseInt($('#productReviews').value) || 0,
            description: $('#productDescription').value.trim(),
            image: $('#productImageData').value || $('#productImage').value.trim() || null,
            featured: $('#productFeatured').checked,
            warranty: $('#productWarranty').value.trim() || null,
            variants: variants,
        };

        const editId = productEditId.value;
        if (editId) {
            // Edit existing
            const idx = products.findIndex(p => p.id === editId);
            if (idx !== -1) {
                products[idx] = { ...products[idx], ...data };
                saveJSON(STORAGE_PRODUCTS, products);
                showToast('Product updated successfully.', 'success');
            }
        } else {
            // Add new
            data.id = uid();
            data.createdAt = Date.now();
            products.push(data);
            saveJSON(STORAGE_PRODUCTS, products);
            showToast('Product added successfully.', 'success');
        }

        resetProductForm();
        showAdminSection('products');
    });

    // Cancel
    $('#cancelProductForm').addEventListener('click', () => {
        resetProductForm();
        showAdminSection('products');
    });

    // ---- Edit / Delete via event delegation ----
    document.addEventListener('click', e => {
        // Edit
        if (e.target.matches('[data-edit]')) {
            const id = e.target.dataset.edit;
            const product = products.find(p => p.id === id);
            if (product) {
                showAdminSection('add-product');
                populateProductForm(product);
            }
        }
        // Delete
        if (e.target.matches('[data-delete]')) {
            const id = e.target.dataset.delete;
            showConfirm('Delete Product?', 'This cannot be undone. The product will be removed permanently.', () => {
                products = products.filter(p => p.id !== id);
                saveJSON(STORAGE_PRODUCTS, products);
                showToast('Product deleted.', 'info');
                // Re-render current section
                const dashboardVisible = $('#adminDashboard').style.display !== 'none';
                if (dashboardVisible) renderDashboard(); else renderAdminProducts();
            });
        }
    });

    // ---- Settings ----
    function populateSettings() {
        $('#siteName').value = siteSettings.name || 'Keyzes';
        $('#siteTagline').value = siteSettings.tagline || '';
        $('#siteDescription').value = siteSettings.description || '';
        $('#settingsUsername').value = siteSettings.username || 'admin';
        $('#settingsPassword').value = '';
    }

    $('#siteSettingsForm').addEventListener('submit', e => {
        e.preventDefault();
        siteSettings.name = $('#siteName').value.trim() || 'Keyzes';
        siteSettings.tagline = $('#siteTagline').value.trim();
        siteSettings.description = $('#siteDescription').value.trim();
        const newUser = $('#settingsUsername').value.trim();
        const newPass = $('#settingsPassword').value;
        if (newUser) siteSettings.username = newUser;
        if (newPass) siteSettings.password = newPass;
        saveJSON(STORAGE_SETTINGS, siteSettings);
        showToast('Settings saved.', 'success');
    });

    // Export products
    $('#exportData').addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(products, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'keyzes-products.json';
        a.click();
        URL.revokeObjectURL(url);
        showToast('Products exported.', 'info');
    });

    // Import products
    $('#importData').addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const imported = JSON.parse(reader.result);
                if (!Array.isArray(imported)) throw new Error('Invalid format');
                // Assign ids if missing
                imported.forEach(p => { if (!p.id) p.id = uid(); });
                products = imported;
                saveJSON(STORAGE_PRODUCTS, products);
                showToast(`Imported ${imported.length} products.`, 'success');
                renderAdminProducts();
                renderDashboard();
            } catch {
                showToast('Invalid JSON file.', 'error');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    });

    // Clear all data
    $('#clearAllData').addEventListener('click', () => {
        showConfirm('Clear All Products?', 'This will permanently delete every product. This cannot be undone.', () => {
            products = [];
            saveJSON(STORAGE_PRODUCTS, products);
            renderAdminProducts();
            renderDashboard();
            showToast('All products cleared.', 'info');
        });
    });

    // ---- Confirm Modal ----
    let confirmCallback = null;

    function showConfirm(title, msg, onConfirm) {
        $('#confirmModalTitle').textContent = title;
        $('#confirmModalMsg').textContent = msg;
        confirmCallback = onConfirm;
        $('#confirmModal').classList.add('open');
    }

    $('#confirmCancel').addEventListener('click', () => {
        $('#confirmModal').classList.remove('open');
        confirmCallback = null;
    });

    $('#confirmOk').addEventListener('click', () => {
        if (confirmCallback) confirmCallback();
        $('#confirmModal').classList.remove('open');
        confirmCallback = null;
    });

    // ---- Toast ----
    function showToast(message, type = 'info') {
        const toast = $('#toast');
        toast.textContent = message;
        toast.className = 'toast toast-' + type + ' show';
        setTimeout(() => toast.classList.remove('show'), 3000);
    }

    // ===========================
    //  SEED PRODUCTS
    // ===========================

    function getSeedProducts() {
        return [
            { id: uid(), title: 'GTA V Premium Edition', category: 'games', platform: 'pc', price: 14.99, originalPrice: 29.99, badge: 'sale', rating: 4.8, reviews: 2340, featured: true, image: null, description: 'Grand Theft Auto V Premium Edition key.', warranty: 'Lifetime', createdAt: Date.now() - 100000, variants: [{name:'Standard',price:14.99},{name:'Premium Online',price:22.99}] },
            { id: uid(), title: 'Red Dead Redemption 2', category: 'games', platform: 'pc', price: 29.99, originalPrice: 59.99, badge: 'hot', rating: 4.9, reviews: 1890, featured: true, image: null, description: 'RDR2 activation key for PC.', warranty: '6 months', createdAt: Date.now() - 90000, variants: [{name:'Standard',price:29.99},{name:'Ultimate',price:44.99}] },
            { id: uid(), title: 'Windows 11 Pro Key', category: 'software', platform: 'pc', price: 24.99, originalPrice: 139.99, badge: 'sale', rating: 4.6, reviews: 980, featured: true, image: null, description: 'Genuine Windows 11 Professional license key.', warranty: 'Lifetime', createdAt: Date.now() - 80000, variants: [{name:'Home',price:18.99},{name:'Pro',price:24.99},{name:'Enterprise',price:49.99}] },
            { id: uid(), title: 'Microsoft Office 365', category: 'software', platform: 'pc', price: 44.99, originalPrice: 99.99, badge: 'sale', rating: 4.7, reviews: 1560, featured: true, image: null, description: 'Office 365 annual subscription key.', warranty: '1 year', createdAt: Date.now() - 70000, variants: [{name:'Personal - 1 Year',price:44.99},{name:'Family - 1 Year',price:64.99},{name:'Business - 1 Year',price:89.99}] },
            { id: uid(), title: 'Steam Gift Card $50', category: 'gift-cards', platform: 'pc', price: 46.99, originalPrice: null, badge: 'new', rating: 4.9, reviews: 3200, featured: false, image: null, description: '$50 Steam Wallet gift card code.', createdAt: Date.now() - 60000, variants: [{name:'$20',price:18.99},{name:'$50',price:46.99},{name:'$100',price:93.49}] },
            { id: uid(), title: 'PlayStation Plus', category: 'subscriptions', platform: 'playstation', price: 24.99, originalPrice: 59.99, badge: 'sale', rating: 4.5, reviews: 870, featured: false, image: null, description: 'PS Plus membership.', createdAt: Date.now() - 50000, variants: [{name:'1 Month',price:9.99},{name:'3 Months',price:24.99},{name:'12 Months',price:39.99}] },
            { id: uid(), title: 'Xbox Game Pass Ultimate', category: 'subscriptions', platform: 'xbox', price: 12.99, originalPrice: 44.99, badge: 'hot', rating: 4.8, reviews: 2100, featured: true, image: null, description: 'Xbox Game Pass Ultimate subscription.', createdAt: Date.now() - 40000, variants: [{name:'1 Month',price:12.99},{name:'3 Months',price:29.99},{name:'6 Months',price:54.99}] },
            { id: uid(), title: 'Cyberpunk 2077', category: 'games', platform: 'pc', price: 24.99, originalPrice: 59.99, badge: 'sale', rating: 4.3, reviews: 1450, featured: false, image: null, description: 'Cyberpunk 2077 PC activation key.', createdAt: Date.now() - 30000, variants: [{name:'Standard',price:24.99},{name:'Ultimate',price:39.99}] },
            { id: uid(), title: 'Elden Ring', category: 'games', platform: 'pc', price: 39.99, originalPrice: null, badge: 'hot', rating: 4.9, reviews: 3100, featured: true, image: null, description: 'Elden Ring Steam key.', createdAt: Date.now() - 20000, variants: [{name:'Standard',price:39.99},{name:'Deluxe',price:54.99}] },
            { id: uid(), title: 'Nintendo eShop', category: 'gift-cards', platform: 'nintendo', price: 14.49, originalPrice: null, badge: null, rating: 4.7, reviews: 540, featured: false, image: null, description: 'Nintendo eShop gift card code.', createdAt: Date.now() - 15000, variants: [{name:'$15',price:14.49},{name:'$35',price:33.49},{name:'$50',price:47.99}] },
            { id: uid(), title: 'FIFA 25', category: 'games', platform: 'multi', price: 34.99, originalPrice: 89.99, badge: 'sale', rating: 4.2, reviews: 760, featured: false, image: null, description: 'FIFA 25 multi-platform key.', createdAt: Date.now() - 12000, variants: [{name:'Standard',price:34.99},{name:'Ultimate Edition',price:49.99}] },
            { id: uid(), title: 'Norton 360 Deluxe', category: 'software', platform: 'pc', price: 19.99, originalPrice: 49.99, badge: 'sale', rating: 4.4, reviews: 320, featured: false, image: null, description: 'Norton 360 Deluxe antivirus license.', createdAt: Date.now() - 10000, variants: [{name:'1 Year',price:19.99},{name:'2 Years',price:34.99}] },
            { id: uid(), title: 'V-Bucks', category: 'in-game', platform: 'multi', price: 7.99, originalPrice: null, badge: 'new', rating: 4.6, reviews: 1800, featured: false, image: null, description: 'Fortnite V-Bucks code.', createdAt: Date.now() - 8000, variants: [{name:'1000',price:7.99},{name:'2800',price:19.99},{name:'5000',price:31.99},{name:'13500',price:79.99}] },
            { id: uid(), title: 'Minecraft Java & Bedrock', category: 'games', platform: 'pc', price: 19.99, originalPrice: 29.99, badge: null, rating: 4.8, reviews: 4200, featured: true, image: null, description: 'Minecraft Java + Bedrock bundle.', createdAt: Date.now() - 5000, variants: [{name:'Java Edition',price:19.99},{name:'Java & Bedrock',price:26.99}] },
            { id: uid(), title: 'Adobe Creative Cloud', category: 'software', platform: 'pc', price: 89.99, originalPrice: 599.99, badge: 'hot', rating: 4.5, reviews: 410, featured: false, image: null, description: 'Adobe CC all apps subscription.', createdAt: Date.now() - 3000, variants: [{name:'1 Month',price:89.99},{name:'6 Months',price:179.99},{name:'1 Year',price:299.99}] },
            { id: uid(), title: 'Spotify Premium', category: 'subscriptions', platform: 'multi', price: 9.99, originalPrice: null, badge: 'new', rating: 4.7, reviews: 920, featured: false, image: null, description: 'Spotify Premium gift card.', createdAt: Date.now() - 1000, variants: [{name:'1 Month',price:9.99},{name:'3 Months',price:24.99},{name:'6 Months',price:34.99}] },
            { id: uid(), title: 'Hogwarts Legacy', category: 'games', platform: 'pc', price: 29.99, originalPrice: 59.99, badge: 'sale', rating: 4.7, reviews: 2870, featured: true, image: null, description: 'Hogwarts Legacy PC Steam key.', createdAt: Date.now() - 900, variants: [{name:'Standard',price:29.99},{name:'Deluxe',price:44.99}] },
            { id: uid(), title: 'God of War Ragnarok', category: 'games', platform: 'playstation', price: 34.99, originalPrice: 69.99, badge: 'hot', rating: 4.9, reviews: 3450, featured: true, image: null, description: 'God of War Ragnarok PS5 key.', createdAt: Date.now() - 800, variants: [{name:'Standard',price:34.99},{name:'Digital Deluxe',price:49.99}] },
            { id: uid(), title: 'Halo Infinite', category: 'games', platform: 'xbox', price: 19.99, originalPrice: 59.99, badge: 'sale', rating: 4.1, reviews: 1230, featured: false, image: null, description: 'Halo Infinite Xbox/PC digital key.', createdAt: Date.now() - 700, variants: [{name:'Standard',price:19.99},{name:'Campaign + MP',price:34.99}] },
            { id: uid(), title: 'The Witcher 3 GOTY', category: 'games', platform: 'pc', price: 9.99, originalPrice: 49.99, badge: 'sale', rating: 4.9, reviews: 5600, featured: true, image: null, description: 'The Witcher 3 Game of the Year Edition.', createdAt: Date.now() - 600, variants: [{name:'Standard',price:9.99},{name:'Complete Edition',price:14.99}] },
            { id: uid(), title: 'NordVPN', category: 'software', platform: 'multi', price: 11.99, originalPrice: 59.99, badge: 'hot', rating: 4.6, reviews: 2100, featured: false, image: null, description: 'NordVPN premium subscription.', createdAt: Date.now() - 500, variants: [{name:'1 Month',price:11.99},{name:'1 Year',price:49.99},{name:'2 Years',price:79.99}] },
            { id: uid(), title: 'Xbox Gift Card', category: 'gift-cards', platform: 'xbox', price: 23.99, originalPrice: null, badge: null, rating: 4.8, reviews: 1340, featured: false, image: null, description: 'Xbox digital gift card code.', createdAt: Date.now() - 400, variants: [{name:'$25',price:23.99},{name:'$50',price:47.49},{name:'$100',price:94.99}] },
            { id: uid(), title: 'Apex Legends Coins', category: 'in-game', platform: 'multi', price: 9.49, originalPrice: null, badge: 'new', rating: 4.5, reviews: 890, featured: false, image: null, description: 'Apex Legends in-game coins.', createdAt: Date.now() - 300, variants: [{name:'1000',price:9.49},{name:'2150',price:18.99},{name:'4350',price:37.99},{name:'11500',price:89.99}] },
            { id: uid(), title: 'Starfield', category: 'games', platform: 'pc', price: 34.99, originalPrice: 69.99, badge: 'sale', rating: 4.0, reviews: 980, featured: false, image: null, description: 'Starfield PC Steam key.', createdAt: Date.now() - 250, variants: [{name:'Standard',price:34.99},{name:'Premium',price:54.99}] },
            { id: uid(), title: 'YouTube Premium', category: 'subscriptions', platform: 'multi', price: 8.99, originalPrice: null, badge: null, rating: 4.4, reviews: 670, featured: false, image: null, description: 'YouTube Premium subscription gift card.', createdAt: Date.now() - 200, variants: [{name:'1 Month',price:8.99},{name:'3 Months',price:24.99},{name:'12 Months',price:89.99}] },
            { id: uid(), title: 'Baldurs Gate 3', category: 'games', platform: 'pc', price: 44.99, originalPrice: 59.99, badge: 'hot', rating: 4.9, reviews: 4100, featured: true, image: null, description: 'Baldurs Gate 3 Steam key.', createdAt: Date.now() - 180, variants: [{name:'Standard',price:44.99},{name:'Digital Deluxe',price:59.99}] },
            { id: uid(), title: 'Roblox Gift Card', category: 'gift-cards', platform: 'multi', price: 9.49, originalPrice: null, badge: 'new', rating: 4.7, reviews: 2800, featured: false, image: null, description: 'Roblox digital gift card for Robux.', createdAt: Date.now() - 160, variants: [{name:'$10',price:9.49},{name:'$25',price:23.49},{name:'$50',price:46.99}] },
            { id: uid(), title: 'Kaspersky Total Security', category: 'software', platform: 'pc', price: 14.99, originalPrice: 39.99, badge: 'sale', rating: 4.3, reviews: 440, featured: false, image: null, description: 'Kaspersky Total Security license key.', createdAt: Date.now() - 140, variants: [{name:'1 Device - 1 Year',price:14.99},{name:'3 Devices - 1 Year',price:24.99},{name:'5 Devices - 2 Years',price:44.99}] },
            { id: uid(), title: 'Call of Duty MW3', category: 'games', platform: 'multi', price: 39.99, originalPrice: 69.99, badge: 'sale', rating: 4.1, reviews: 1670, featured: false, image: null, description: 'Call of Duty Modern Warfare 3 key.', createdAt: Date.now() - 120, variants: [{name:'Standard',price:39.99},{name:'Vault Edition',price:64.99}] },
            { id: uid(), title: 'Disney+ Subscription', category: 'subscriptions', platform: 'multi', price: 7.99, originalPrice: null, badge: null, rating: 4.6, reviews: 1150, featured: false, image: null, description: 'Disney+ streaming subscription gift card.', createdAt: Date.now() - 100, variants: [{name:'1 Month',price:7.99},{name:'3 Months',price:21.99},{name:'12 Months',price:79.99}] },
            { id: uid(), title: 'Valorant Points', category: 'in-game', platform: 'pc', price: 9.99, originalPrice: null, badge: 'hot', rating: 4.5, reviews: 2340, featured: false, image: null, description: 'Valorant Points for skins and battle pass.', createdAt: Date.now() - 80, variants: [{name:'1000 VP',price:9.99},{name:'2050 VP',price:19.99},{name:'3650 VP',price:34.99},{name:'5350 VP',price:49.99}] },
            { id: uid(), title: 'Spider-Man 2', category: 'games', platform: 'playstation', price: 39.99, originalPrice: 69.99, badge: 'sale', rating: 4.8, reviews: 2900, featured: true, image: null, description: 'Marvels Spider-Man 2 PS5 digital key.', createdAt: Date.now() - 60, variants: [{name:'Standard',price:39.99},{name:'Digital Deluxe',price:54.99}] },
            { id: uid(), title: 'WinRAR License', category: 'software', platform: 'pc', price: 14.99, originalPrice: 29.99, badge: null, rating: 4.2, reviews: 380, featured: false, image: null, description: 'WinRAR lifetime license key.', createdAt: Date.now() - 40, variants: [{name:'Single User',price:14.99},{name:'Multi-User (5)',price:39.99}] },
            { id: uid(), title: 'League of Legends RP', category: 'in-game', platform: 'pc', price: 9.99, originalPrice: null, badge: 'new', rating: 4.6, reviews: 3100, featured: false, image: null, description: 'League of Legends Riot Points.', createdAt: Date.now() - 20, variants: [{name:'1380 RP',price:9.99},{name:'2800 RP',price:19.99},{name:'5000 RP',price:34.99},{name:'10000 RP',price:64.99}] },
            { id: uid(), title: 'Netflix Gift Card', category: 'gift-cards', platform: 'multi', price: 14.49, originalPrice: null, badge: null, rating: 4.8, reviews: 4500, featured: true, image: null, description: 'Netflix digital gift card.', createdAt: Date.now() - 10, variants: [{name:'$15',price:14.49},{name:'$30',price:28.99},{name:'$50',price:47.99},{name:'$100',price:94.99}] },
            { id: uid(), title: 'Zelda Tears of the Kingdom', category: 'games', platform: 'nintendo', price: 44.99, originalPrice: 69.99, badge: 'hot', rating: 4.9, reviews: 3800, featured: true, image: null, description: 'The Legend of Zelda: Tears of the Kingdom digital key.', createdAt: Date.now() - 5, variants: [{name:'Standard',price:44.99},{name:'+ Expansion Pass',price:64.99}] },
        ];
    }

    // Email confirmation overlay buttons
    document.getElementById('emailConfirmGoBtn').addEventListener('click', () => {
        hideEmailConfirmOverlay();
        showStorefront();
    });
    document.getElementById('emailConfirmRetryBtn').addEventListener('click', () => {
        hideEmailConfirmOverlay();
        showStorefront();
    });

    // ===========================
    //  INIT
    // ===========================

    renderProducts();
    initializeCustomerAuth();

    // If admin session was saved, keep auth state but don't auto-open panel
    // They can click the gear icon to open it

})();
