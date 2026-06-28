{
  "name": "bot-de-grupo-de-ofertas",
  "version": "1.0.0",
  "description": "Bot de Afiliados e Grupo de Ofertas para Telegram com Painel Web",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node server.js"
  },
  "keywords": [
    "telegram",
    "bot",
    "affiliate",
    "shopee",
    "amazon",
    "aliexpress",
    "mercadolivre"
  ],
  "author": "",
  "license": "ISC",
  "dependencies": {
    "axios": "^1.7.2",
    "cheerio": "^1.0.0-rc.12",
    "express": "^4.19.2"
  }
}

        title: '',
        oldPrice: '',
        price: '',
        image: '',
        marketplace: '',
        coupon: ''
    },
    automation: {
        active: false,
        timer: null,
        blacklist: '',
        alreadyPostedDeals: [],
        category: 'all',
        autoFacebook: false
    },
    instagram: {
        token: '',
        businessId: '',
        textTop: 'SUPER OFERTA!',
        textBottom: 'LINK NO GRUPO NA BIO! ðŸ‘†',
        theme: 'instagram',
        duration: 30,
        videoBlob: null,
        autoPost: false
    }
};

/* ==========================================================================
   INIT
































































































































































































































































































































































































































































































































































                                    <p>Nenhuma imagem</p>
                                </div>
                            </div>
                            
                            <!-- Message content (rendered HTML) -->
                            <div class="tg-message-text" id="preview-text">
                                ðŸ”¥ <strong>Smartphone Novo Modelo</strong><br><br>
                                ðŸ’µ De: <del>R$ 1.999,00</del><br>
                                ðŸ¤‘ Por apenas: <strong>R$ 1.499,00</strong><br><br>
                                ðŸ›’ Compre aqui: <a href="#" onclick="event.preventDefault();">https://amzn.to/link-afiliado</a>
                            </div>

                            <!-- Telegram Inline Button -->
                            <div class="tg-message-inline-btn" id="preview-btn-wrap">
                                <a href="#" target="_blank" class="tg-inline-button" id="preview-action-btn">
                                    <i class="fa-solid fa-cart-shopping"></i> COMPRAR AGORA
                                </a>
                            </div>

                            <!-- Footer metadata -->
                            <div class="tg-message-footer">
                                <span class="tg-views"><i class="fa-solid fa-eye"></i> 1</span>
                                <span class="tg-time" id="preview-time">12:00</span>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </main>
    </div>

    <!-- Notification Toast System -->
    <div class="toast-container" id="toast-container"></div>

    <!-- App Script -->
    <script src="app.js"></script>
</body>
</html>
























































































































            const blacklist = ['OFF', 'DESCONTO', 'REAIS', 'OFERTA', 'CUPOM', 'GRATIS', 'FRETE'];
            if (!blacklist.includes(potential)) {
                return potential;
            }
        }
    }
    return '';
}

function extractSchemaAndMetaValues(doc) {
    let title = '';
    let image = '';
    let price = '';
    let oldPrice = '';
    let coupon = extractCouponFromDoc(doc) || '';
    
    // Check for Next.js __NEXT_DATA__ (highly reliable for Promobit)
    const nextDataEl = doc.getElementById('__NEXT_DATA__');
    if (nextDataEl) {
        try {
            const nextData = JSON.parse(nextDataEl.textContent);
            const serverOffer = nextData.props?.pageProps?.serverOffer;
            if (serverOffer) {
                title = serverOffer.offerTitle || title;
                price = serverOffer.offerPrice ? String(serverOffer.offerPrice) : price;
                oldPrice = serverOffer.offerOldPrice ? String(serverOffer.offerOldPrice) : oldPrice;
                coupon = serverOffer.offerCoupon || coupon;
                
                if (serverOffer.offerPhoto) {
                    image = serverOffer.offerPhoto.startsWith('http') || serverOffer.offerPhoto.startsWith('//')
                        ? serverOffer.offerPhoto
                        : `https://www.promobit.com.br/static/p${serverOffer.offerPhoto}`;
                }
            }
        } catch (e) {
            console.error("Erro ao fazer parse de __NEXT_DATA__", e);
        }
    }
    
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
        try {
            const json = JSON.parse(script.textContent);
            const items = Array.isArray(json) ? json : (json['@graph'] ? json['@graph'] : [json]);
            for (const item of items) {
                if (item['@type'] === 'Product' || item['type'] === 'Product') {
                    if (item.name && !title) title = item.name;
                    if (item.image && !image) {
                        image = Array.isArray(item.image) ? item.image[0] : item.image;
                    }
                    if (item.offers) {
                        const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
                        if (offers.price && !price) price = String(offers.price);
                        if (offers.lowPrice && !price) price = String(offers.lowPrice);
                        if (offers.highPrice && !oldPrice) oldPrice = String(offers.highPrice);
                    }
                }
            }
        } catch (e) {}
    }
    
    if (!title) {
        title = getMetaValue(doc, 'og:title') || getMetaValue(doc, 'twitter:title') || doc.title || '';
    }
    if (!image) {
        image = getMetaValue(doc, 'og:image') || getMetaValue(doc, 'twitter:image') || '';
    }
    if (!price) {
        price = getMetaValue(doc, 'product:price:amount') || 
                getMetaValue(doc, 'og:price:amount') || 
                getMetaValue(doc, 'price') ||

















































































































































































































































































































































































































































































































































































































































































































































                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });
}

window.reuseOffer = function(index) {
    const item = state.history[index];
    if (!item) return;

    state.currentProduct = {
        rawUrl: '',
        convertedUrl: '',
        title: item.title,
        oldPrice: '',
        price: item.price,
        image: item.image,
        marketplace: item.marketplace
    };

    document.getElementById('prod-title').value = item.title;
    document.getElementById('prod-price-old').value = '';
    document.getElementById('prod-price-new').value = item.price;
    document.getElementById('prod-image').value = item.image;
    document.getElementById('prod-aff-url').value = '';

    document.getElementById('btn-tab-converter').click();
    document.getElementById('product-form').style.display = 'block';
    
    generateDefaultMessageText();
    updateLivePreview();
    
    showToast('Dados da oferta carregados no conversor!', 'info');
};

window.deleteHistoryItem = function(index) {
    state.history.splice(index, 1);
    localStorage.setItem('cfg_history_tg', JSON.stringify(state.history));
    renderHistory();
    showToast('Oferta removida do histÃ³rico.', 'info');
};

/* ==========================================================================
   UI UTILS & HELPERS
   ========================================================================== */
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'fa-circle-info';
    if (type === 'success') icon = 'fa-circle-check';
    if (type === 'error') icon = 'fa-circle-exclamation';
    if (type === 'warning') icon = 'fa-triangle-exclamation';

    toast.innerHTML = `
        <i class="fa-solid ${icon}"></i>
        <span class="toast-message">${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 4000);
}

function copyTextToClipboard(text, successMsg = 'Copiado!') {
    navigator.clipboard.writeText(text).then(() => {
        showToast(successMsg, 'success');
    }).catch(err => {
        console.error('Falha ao copiar texto: ', err);
        showToast('Erro ao copiar para a Ã¡rea de transferÃªncia.', 'error');
    });
}

/* ==========================================================================
   AUTOMATION CORE FUNCTIONS (BROWSER SCRAPER LOOP)
   ========================================================================== */
function writeLog(message, type = 'info') {
    const logsArea = document.getElementById('console-logs-area');
    if (!logsA











































































































































































































































































































































































































































































































































































































































































































































        }
    }
    else if (platform === 'shopee') {
        const itemMatch = url.match(/-i\.(\d+)\.(\d+)/i) || url.match(/\/product\/(\d+)\/(\d+)/i);
        if (itemMatch) {
            return `shopee:${itemMatch[1]}_${itemMatch[2]}`;
        }
    }
    else if (platform === 'aliexpress') {
        const itemMatch = url.match(/\/item\/(\d+)\.html/i) || url.match(/\/item\/(\d+)/i);
        if (itemMatch) {
            return `aliexpress:${itemMatch[1]}`;
        }
    }
    
    // Fallback: use cleaned domain + path without query params
    try {
        const parsed = new URL(url);
        return `${platform}:${parsed.origin}${parsed.pathname}`.toLowerCase();
    } catch (e) {
        return `${platform}:${url}`.toLowerCase();
    }
}

function saveDealPostedId(id, productKey = null) {
    let updated = false;
    if (!state.automation.alreadyPostedDeals.includes(id)) {
        state.automation.alreadyPostedDeals.push(id);
        updated = true;
    }
    if (productKey && !state.automation.alreadyPostedDeals.includes(productKey)) {
        state.automation.alreadyPostedDeals.push(productKey);
        updated = true;
    }
    if (updated) {
        // Keep max 400 history items for duplicate checking to support keys
        if (state.automation.alreadyPostedDeals.length > 400) {
            state.automation.alreadyPostedDeals.shift();
        }
        localStorage.setItem('cfg_already_posted', JSON.stringify(state.automation.alreadyPostedDeals));
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/* ==========================================================================
   INSTAGRAM REELS AI VIDEO GENERATOR & CAPTION LOGIC
   ========================================================================== */
function updateInstagramFieldsFromProduct() {
    const captionArea = document.getElementById('ig-caption-text');
    if (captionArea) {
        captionArea.value = generateInstagramCaption(state.currentProduct);
        document.getElementById('simulator-caption-txt').innerText = `ðŸ”¥ ${state.currentProduct.title || 'Oferta imperdÃ­vel'}...`;
    }

    // Toggle Simulator Overlays based on postType (reels vs stories) and sponsored ad status
    const isStories = state.instagram.postType === 'stories';
    const isSponsored = state.instagram.sponsored;

    const elSwipeUp = document.getElementById('simulator-swipe-up');
    const elRightActions = document.getElementById('simulator-right-actions');
    const elAudioBadge = document.getElementById('simulator-audio-badge');
    const elFollowBtn = document.getElementById('simulator-follow-btn');
    const elAdBadge = document.getElementById('simulator-ad-badge');
    const elPublishBtn = document.getElementById('btn-ig-publish');

    if (elSwipeUp) elSwipeUp.style.display = isStories ? 'flex' : 'none';
    if (elRightActions) elRightActions.style.display = isStories ? 'none' : 'flex';
    if (elAudioBadge) elAudioBadge.style.display = isStories ? 




























































































































































































































































































































































































































































































































































































































































































































































/* ==========================================================================
   FACEBOOK PAGE PUBLISHING ENGINE
   ========================================================================== */
async function publishToFacebookPage(imageUrl, text, affiliateUrl) {
    const accessToken = state.config.fbToken;
    const pageId = state.config.fbPageId;
    
    if (!accessToken || !pageId) {
        throw new Error("Credenciais do Facebook nÃ£o configuradas nas 'ConfiguraÃ§Ãµes'.");
    }
    
    let urlCall = '';
    let paramsObj = {
        access_token: accessToken
    };
    
    // Strip HTML tags for clean Facebook raw text formatting
    let fbText = text
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/?[a-z][a-z0-9]*[^<>]*>/gi, '');
    
    if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
        urlCall = `https://graph.facebook.com/v19.0/${pageId}/photos`;
        paramsObj.url = imageUrl;
        paramsObj.caption = fbText;
    } else {
        urlCall = `https://graph.facebook.com/v19.0/${pageId}/feed`;
        paramsObj.message = fbText;
        if (affiliateUrl) {
            paramsObj.link = affiliateUrl;
        }
    }
    
    const containerParams = new URLSearchParams(paramsObj);
    
    const response = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(urlCall + '?' + containerParams.toString())}`, {
        method: 'POST'
    });
    
    if (!response.ok) throw new Error("Erro de conexÃ£o com a API do Facebook (Meta)");
    const data = await response.json();
    
    if (data.error) {
        throw new Error(`Erro Facebook API: ${data.error.message}`);
    }
    
    return data.post_id || data.id;
}

async function handlePostFacebook() {
    const text = document.getElementById('message-content').value;
    const imageUrl = document.getElementById('prod-image').value.trim();
    const affUrl = document.getElementById('prod-aff-url').value.trim();
    
    if (!text) {
        showToast('NÃ£o hÃ¡ conteÃºdo no post para enviar ao Facebook.', 'warning');
        return;
    }
    
    const token = state.config.fbToken;
    const pageId = state.config.fbPageId;
    
    if (!token || !pageId) {
        showToast('Configure as credenciais do Facebook nas "ConfiguraÃ§Ãµes" primeiro.', 'error');
        document.getElementById('btn-tab-config').click();
        return;
    }
    
    const btn = document.getElementById('btn-post-facebook');
    btn.disabled = true;
    btn.innerHTML = '<span>Postando...</span> <i class="fa-solid fa-spinner fa-spin"></i>';
    
    try {
        showToast('Enviando post para o Facebook...', 'info');
        const postId = await publishToFacebookPage(imageUrl, text, affUrl);
        showToast('Oferta enviada com sucesso para a PÃ¡gina do Facebook!', 'success');
        writeLog(`[Manual] Post enviado para Facebook Page! ID: ${postId}`, 'success');
    } catch (err) {
        showToast(`Falha no Facebook: ${err.message}`, 'error');
        writeLog(`Erro ao enviar post manual para o Facebook: ${err.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>Postar no Facebook</span> <i class="fa-brands fa-facebook"></i>';
    }
}



