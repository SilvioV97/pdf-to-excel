import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
).href;

const SCHEMA = [
    'FECHA OPER.', 'FECHA VALOR', 'DESCRIPCION',
    'OFICINA', 'CAN', 'N° OPER.', 'CARGO/ABONO',
    'ITF', 'SALDO CONTABLE'
];

export async function extractPdfData(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pagesData = [];
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1.0 });
        const items = textContent.items.map(item => ({
            text: item.str,
            x: item.transform[4],
            y: viewport.height - item.transform[5],
            width: item.width,
            height: item.height
        }));
        pagesData.push({ pageNumber: i, items });
    }
    return pagesData;
}

function groupIntoRows(items, tolerance = 6) {
    const sorted = [...items].filter(i => i.text.trim() !== '').sort((a, b) => a.y - b.y || a.x - b.x);
    const rows = [];
    let currentRow = [];
    let lastY = null;
    for (const item of sorted) {
        if (lastY === null || Math.abs(item.y - lastY) <= tolerance) {
            currentRow.push(item);
        } else {
            rows.push({ y: lastY, items: currentRow.sort((a, b) => a.x - b.x) });
            currentRow = [item];
        }
        lastY = item.y;
    }
    if (currentRow.length > 0) rows.push({ y: lastY, items: currentRow.sort((a, b) => a.x - b.x) });
    return rows;
}

function normalizeLabel(lbl) {
    const v = lbl.toUpperCase().replace(/\s+/g, ' ').trim();
    if (v.includes('FECHA') && v.includes('VALOR')) return 'FECHA VALOR';
    if (v.includes('FECHA') && (v.includes('OPER') || v.includes('F.'))) return 'FECHA OPER.';
    if (v === 'VALOR') return 'FECHA VALOR';
    if (v === 'OPER.' || v === 'OPER') return 'FECHA OPER.';
    if (v.includes('FECHA')) return 'FECHA OPER.';
    if (v.includes('DESCRIP') || v.includes('CONCEPTO')) return 'DESCRIPCION';
    if (v.includes('OFICINA')) return 'OFICINA';
    if (v.includes('CAN')) return 'CAN';
    if ((v.includes('N°') || v.includes('NRO') || v.includes('NUM')) && (v.includes('OPER') || v.includes('OP'))) return 'N° OPER.';
    if (v.includes('CARGO') || v.includes('ABONO')) return 'CARGO/ABONO';
    if (v.includes('ITF')) return 'ITF';
    if (v.includes('SALDO') || v.includes('CONTABLE')) return 'SALDO CONTABLE';
    return v;
}

const DATE_REGEX = /^\d{2}-\d{2}$/;

function isHeaderRowStrict(rowItems) {
    const texts = rowItems.map(i => i.text.toLowerCase());
    const matches = ['fecha', 'descr', 'saldo', 'cargo', 'oficina'].filter(sig =>
        texts.some(t => t.includes(sig))
    ).length;
    return matches >= 3 && rowItems.length >= 5;
}

export function detectTables(pagesData) {
    const xMap = {};
    for (const page of pagesData) {
        const rows = groupIntoRows(page.items);
        for (let i = 0; i < Math.min(rows.length, 30); i++) {
            if (!isHeaderRowStrict(rows[i].items)) continue;
            const r1 = rows[i].items;
            const r2 = rows[i + 1]?.items || [];
            r1.forEach(item => {
                const center = item.x + item.width / 2;
                const cont = r2.find(ni => Math.abs((ni.x + ni.width / 2) - center) < 35);
                const label = normalizeLabel(cont ? `${item.text} ${cont.text}` : item.text);
                if (SCHEMA.includes(label)) {
                    if (!xMap[label]) xMap[label] = [];
                    xMap[label].push(item.x);
                }
            });
            r2.forEach(item => {
                const label = normalizeLabel(item.text);
                if (SCHEMA.includes(label) && !xMap[label]?.some(x => Math.abs(x - item.x) < 20)) {
                    if (!xMap[label]) xMap[label] = [];
                    xMap[label].push(item.x);
                }
            });
        }
    }

    const masterCols = SCHEMA.map(label => {
        const xs = xMap[label];
        if (!xs || xs.length === 0) return null;
        const avgX = xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
        return { label, x: avgX };
    }).filter(c => c !== null).sort((a, b) => a.x - b.x);

    let fechaCount = 0;
    masterCols.forEach(c => {
        if (c.label === 'FECHA OPER.') {
            fechaCount++;
            if (fechaCount === 2) c.label = 'FECHA VALOR';
        }
    });

    if (masterCols.length < 5) return [];

    const masterHeader = masterCols.map(c => c.label);
    const boundaries = [];
    for (let i = 0; i < masterCols.length - 1; i++) {
        const mid = (masterCols[i].x + masterCols[i + 1].x) / 2;
        const isDateCol = masterHeader[i].includes('FECHA');
        if (isDateCol) {
            // Use the smaller of a fixed 48px window or the midpoint to prevented overshooting
            boundaries.push(Math.min(masterCols[i].x + 48, mid));
        } else {
            boundaries.push(mid);
        }
    }

    const getSlot = (item, datesFoundInRow) => {
        const text = item.text.trim();
        const isDateLike = DATE_REGEX.test(text);

        // Pattern-based override for dates:
        // The first date found in a row should ideally go to slot 0, the second to slot 1.
        if (isDateLike) {
            if (datesFoundInRow === 0 && masterHeader[0].includes('FECHA')) return 0;
            if (datesFoundInRow === 1 && masterHeader[1].includes('FECHA')) return 1;
        }

        // Initial coordinate slot
        let slot = 0;
        while (slot < boundaries.length && item.x >= boundaries[slot]) slot++;

        // Heuristic: If it's NOT a date but mapped to a date slot, move it to DESCRIPCION (slot 2)
        // unless it's the very first column (FECHA OPER.) and we have no other place for it.
        const descIdx = masterHeader.indexOf('DESCRIPCION');
        if (!isDateLike && slot < 2 && descIdx !== -1) {
            return descIdx;
        }

        return Math.min(slot, masterHeader.length - 1);
    };

    const descIdx = masterHeader.indexOf('DESCRIPCION');
    const saldoIdx = masterHeader.indexOf('SALDO CONTABLE');

    const tables = [];
    for (const page of pagesData) {
        const rows = groupIntoRows(page.items);
        const extracted = [masterHeader];
        let pastHeader = false;

        for (const row of rows) {
            const rowItems = row.items;

            // SPLIT items that contain 2+ spaces (merged columns)
            const splittedItems = [];
            rowItems.forEach(item => {
                if (item.text.includes('  ')) {
                    const parts = item.text.split(/  +/);
                    let offX = 0;
                    parts.forEach(p => {
                        splittedItems.push({ text: p, x: item.x + offX, width: 0 });
                        offX += p.length * 6; // heuristic increment
                    });
                } else {
                    splittedItems.push(item);
                }
            });

            const texts = splittedItems.map(i => i.text.toLowerCase());

            // HARD STOP: If we hit the footer tables, stop processing this page entirely
            if (texts.some(t =>
                t.includes('codigo cuenta interbancaria') ||
                t.includes('saldo a nuestro favor') ||
                t.includes('rogamos verifique la informacion') ||
                t.includes('totales por itf')
            )) {
                break;
            }

            if (isHeaderRowStrict(rowItems)) { pastHeader = true; continue; }
            if (!pastHeader) continue;

            if (texts.some(t => t.includes('página') || t.includes('estado de cuenta'))) continue;
            if (texts.length < 2 && !texts.some(t => t.includes('saldo'))) continue;

            if (texts.some(t => t.includes('saldo anterior') || t.includes('saldo ant'))) {
                const mappedRow = new Array(masterHeader.length).fill('');
                for (const item of splittedItems) {
                    const t = item.text.trim();
                    if (/^-?[\d,\.]+$/.test(t) && t.includes('.') && saldoIdx >= 0) mappedRow[saldoIdx] = t;
                    else if (descIdx >= 0) mappedRow[descIdx] = (mappedRow[descIdx] + ' ' + t).trim();
                }
                extracted.push(mappedRow);
                continue;
            }

            const mappedRow = new Array(masterHeader.length).fill('');
            let datesFoundInRow = 0;
            for (const item of splittedItems) {
                const slot = getSlot(item, datesFoundInRow);
                if (DATE_REGEX.test(item.text.trim())) datesFoundInRow++;

                mappedRow[slot] = (mappedRow[slot] + ' ' + item.text).trim();
            }
            if (mappedRow.some(c => c !== '')) {
                const fechaOperIdx = masterHeader.indexOf('FECHA OPER.');
                const fechaValorIdx = masterHeader.indexOf('FECHA VALOR');

                let hasDate = false;
                if (fechaOperIdx >= 0 && DATE_REGEX.test(mappedRow[fechaOperIdx])) hasDate = true;
                if (fechaValorIdx >= 0 && DATE_REGEX.test(mappedRow[fechaValorIdx])) hasDate = true;

                // Heuristic: If there is no date, this is a continuation of the previous operation's description.
                // We concatenate all text found in this row and merge it into the previous row's DESCRIPCION.
                if (!hasDate && extracted.length > 1) {
                    const prevRow = extracted[extracted.length - 1];
                    const continuationText = mappedRow.filter(c => c !== '').join(' ').trim();
                    if (descIdx >= 0 && continuationText) {
                        prevRow[descIdx] = prevRow[descIdx] ? `${prevRow[descIdx]} ${continuationText}` : continuationText;
                    }
                } else {
                    extracted.push(mappedRow);
                }
            }
        }
        if (extracted.length > 2) tables.push({ page: page.pageNumber, rows: extracted });
    }
    return tables;
}
