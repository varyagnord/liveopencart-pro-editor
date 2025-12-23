const AI_CONFIG = {
    provider: 'easytokens', // 'gemini' или 'easytokens'
    easytokens: {
        url: 'https://api.easytokens.ru/v1/generate',
        key: 'test-ROKS5zEKJFmgweU9v7kBamH8RBp7638h-665e03d4d2d2',
        model: 'easypro'
    },
    gemini: {
        // Базовый URL для Gemini. Обратите внимание: метод добавляется в конце
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models/',
        key: 'AIzaSyB60X1MduckCi82zEyJXEgU7vsEpkyGf-s',
        model: 'gemini-3-pro-preview'
    }
};

/**
 * Преобразует формат сообщений OpenAI [ {role, content} ] 
 * в формат Google Gemini [ {role, parts: [{text}]} ]
 */
function transformMessagesForGemini(messages) {
    return messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
    }));
}

// 1. Обработка обычных запросов
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'UPLOAD_IMAGE') {
        // Вызываем новую функцию Pixeldrain
        uploadToImageService(request.payload)
            .then(url => sendResponse({ success: true, url }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true; 
    }

    if (request.type === 'ASK_AI') {
        const provider = AI_CONFIG.provider;
        const config = AI_CONFIG[provider];

        if (provider === 'gemini') {
            const url = `${config.baseUrl}${config.model}:generateContent?key=${config.key}`;
            
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: transformMessagesForGemini(request.payload)
                })
            })
            .then(res => res.json())
            .then(data => {
                const answer = data.candidates?.[0]?.content?.parts?.[0]?.text || "Ошибка Gemini API";
                sendResponse({ success: true, answer });
            })
            .catch(err => sendResponse({ success: false, error: err.message }));
        } else {
            // Логика для EasyTokens (OpenAI style)
            fetch(config.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.key}`
                },
                body: JSON.stringify({
                    model: config.model,
                    messages: request.payload,
                    stream: false
                })
            })
            .then(res => res.json())
            .then(data => {
                const answer = data.choices ? data.choices[0].message.content : "Ошибка OpenAI формата";
                sendResponse({ success: true, answer });
            })
            .catch(err => sendResponse({ success: false, error: err.message }));
        }
        return true;
    }
});

// 2. Обработка Стриминга (Slash-меню)
chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "ai-stream") return;

    port.onMessage.addListener(async (msg) => {
        if (msg.type === 'ASK_AI_STREAM') {
            const provider = AI_CONFIG.provider;
            const config = AI_CONFIG[provider];

            try {
                if (provider === 'gemini') {
                    const url = `${config.baseUrl}${config.model}:streamGenerateContent?alt=sse&key=${config.key}`;
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: transformMessagesForGemini(msg.payload)
                        })
                    });

                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = "";

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        
                        // Gemini в режиме SSE присылает строки "data: {...}"
                        const lines = buffer.split("\n");
                        buffer = lines.pop(); // Оставляем неполную строку в буфере

                        for (const line of lines) {
                            if (line.startsWith("data: ")) {
                                try {
                                    const json = JSON.parse(line.substring(6));
                                    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
                                    if (text) port.postMessage({ type: 'CHUNK', text: text });
                                } catch (e) {}
                            }
                        }
                    }
                } else {
                    // Логика для OpenAI/EasyTokens
                    const response = await fetch(config.url, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${config.key}`
                        },
                        body: JSON.stringify({
                            model: config.model,
                            messages: msg.payload,
                            stream: true
                        })
                    });

                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        const chunk = decoder.decode(value);
                        const lines = chunk.split('\n');
                        for (const line of lines) {
                            if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                                try {
                                    const data = JSON.parse(line.substring(6));
                                    const content = data.choices[0].delta.content;
                                    if (content) port.postMessage({ type: 'CHUNK', text: content });
                                } catch (e) {}
                            }
                        }
                    }
                }
                port.postMessage({ type: 'DONE' });
            } catch (err) {
                port.postMessage({ type: 'ERROR', error: err.message });
            }
        }
    });
});


async function uploadToImageService(base64Data) {
    const MY_API_URL = "https://s3.opencarter.ru/upload";
    const AUTH_TOKEN = "dsfhggdKJjhjflkfyty66dfghzZfQ"; // Придумай свой токен для защиты

    try {
        const cleanB64 = base64Data.replace(/^data:image\/\w+;base64,/, "").replace(/\s/g, '');
        
        const response = await fetch(MY_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Auth-Token': AUTH_TOKEN
            },
            body: JSON.stringify({ 
                image: cleanB64,
                ext: "jpg" 
            })
        });

        const result = await response.json();
        if (result.url) {
            console.log("[S3] Успех:", result.url);
            return result.url;
        }
        throw new Error(result.error || "Ошибка сервера");
    } catch (e) {
        console.error("[S3] Ошибка загрузки:", e);
        return null;
    }
}