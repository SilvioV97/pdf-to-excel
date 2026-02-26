import React, { useState } from 'react';
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, ChevronRight, Download, Wand2 } from 'lucide-react';
import { extractPdfData, detectTables } from './utils/PdfProcessor';
import { exportToExcel } from './utils/ExcelExporter';

function App() {
    const [file, setFile] = useState(null);
    const [loading, setLoading] = useState(false);
    const [step, setStep] = useState(1); // 1: Upload, 2: Preview/Select, 2.5: Header Selection, 2.8: Final Review, 3: Success
    const [tables, setTables] = useState([]);
    const [selectedTables, setSelectedTables] = useState([]);
    const [selectedHeaders, setSelectedHeaders] = useState([]);
    const [availableHeaders, setAvailableHeaders] = useState([]);
    const [processingError, setProcessingError] = useState(null);
    const [previewData, setPreviewData] = useState([]);

    const handleFileUpload = async (e) => {
        const uploadedFile = e.target.files[0];
        if (!uploadedFile || uploadedFile.type !== 'application/pdf') {
            setProcessingError('Por favor selecciona un archivo PDF válido.');
            return;
        }

        setFile(uploadedFile);
        setLoading(true);
        setTables([]);
        setProcessingError(null);

        try {
            // Small delay for better UX scanning effect
            await new Promise(r => setTimeout(r, 1200));

            const data = await extractPdfData(uploadedFile);
            const detectedTables = detectTables(data);

            if (detectedTables.length === 0) {
                throw new Error('No se detectaron tablas claras. Intenta con otro PDF o verifica el formato.');
            }

            setTables(detectedTables);
            // Automatically select all tables by default
            setSelectedTables(detectedTables.map((_, i) => i));
            setStep(2);
        } catch (err) {
            setProcessingError(err.message || 'Error al procesar el PDF.');
        } finally {
            setLoading(false);
        }
    };

    const TARGET_HEADERS = [
        'FECHA OPER.',
        'FECHA VALOR',
        'DESCRIPCION',
        'OFICINA',
        'CAN',
        'N° OPER.',
        'CARGO/ABONO',
        'ITF',
        'SALDO CONTABLE'
    ];

    // Normalize a single header string to the target schema
    const normalizeHeader = (h) => {
        const val = (h || '').toString().trim().toUpperCase().replace(/\s+/g, ' ');
        if (val.includes('FECHA') && val.includes('VALOR')) return 'FECHA VALOR';
        if (val.includes('FECHA') && (val.includes('OPER') || val.includes('F.'))) return 'FECHA OPER.';
        if (val === 'VALOR') return 'FECHA VALOR';
        if (val === 'OPER.' || val === 'OPER') return 'FECHA OPER.';
        if (val === 'CONTABLE') return 'SALDO CONTABLE';

        // Fallback for generic Fecha
        if (val.includes('FECHA')) return 'FECHA OPER.';

        if (val.includes('DESCRIP') || val.includes('CONCEPTO')) return 'DESCRIPCION';
        if ((val.includes('N°') || val.includes('NRO') || val.includes('NUM')) && (val.includes('OPER') || val.includes('OP'))) return 'N° OPER.';
        if (val.includes('CARGO') || val.includes('ABONO')) return 'CARGO/ABONO';
        if (val.includes('ITF')) return 'ITF';
        if (val.includes('OFICINA')) return 'OFICINA';
        if (val.includes('CAN')) return 'CAN';
        if (val.includes('SALDO') || val.includes('CONTABLE')) return 'SALDO CONTABLE';
        return val;
    };

    const normalizeHeaderArr = (headerArr) => (headerArr || []).map(normalizeHeader);

    const goToHeaderSelection = () => {
        // Collect unique normalized headers from selected tables
        const headerSet = new Set();
        tables.forEach((t, i) => {
            if (selectedTables.includes(i) && t.rows[0]) {
                normalizeHeaderArr(t.rows[0]).forEach(h => headerSet.add(h));
            }
        });
        // Show only target headers that were detected (in canonical order)
        const detected = new Set(headerSet);
        const available = TARGET_HEADERS.filter(h => detected.has(h));
        setAvailableHeaders(available);
        setSelectedHeaders(available); // pre-select all valid ones
        setStep(2.5);
    };

    const goToFinalPreview = () => {
        const activeHeaders = TARGET_HEADERS.filter(h => selectedHeaders.includes(h));
        const combinedData = [activeHeaders];

        tables
            .filter((_, i) => selectedTables.includes(i))
            .forEach(t => {
                // Normalize table headers and build index map
                const tHeaders = normalizeHeaderArr(t.rows[0]);
                const colMap = {};
                tHeaders.forEach((h, idx) => {
                    if (!colMap[h]) colMap[h] = [];
                    colMap[h].push(idx);
                });

                t.rows.slice(1).forEach(row => {
                    const mappedRow = activeHeaders.map(sh => {
                        const idxs = colMap[sh] || [];
                        return idxs.map(i => row[i]).filter(Boolean).join(' ');
                    });
                    if (mappedRow.some(c => c !== '')) {
                        combinedData.push(mappedRow);
                    }
                });
            });

        setPreviewData(combinedData);
        setStep(2.8);
    };

    const updateCell = (rowIndex, colIndex, value) => {
        const newData = [...previewData];
        newData[rowIndex][colIndex] = value;
        setPreviewData(newData);
    };

    const autoFormatData = () => {
        if (!previewData || previewData.length < 2) return;
        const headers = previewData[0];
        const newData = [headers];

        for (let i = 1; i < previewData.length; i++) {
            const newRow = previewData[i].map((cell, colIdx) => {
                if (typeof cell !== 'string') return cell;

                const header = headers[colIdx];
                let val = cell.trim();

                // Auto-format numbers
                if (['CARGO/ABONO', 'SALDO CONTABLE', 'ITF'].includes(header)) {
                    const cleanNum = val.replace(/,/g, '').replace(/\s/g, '');
                    if (!isNaN(cleanNum) && cleanNum !== '' && cleanNum !== '-') {
                        return Number(cleanNum);
                    }
                }

                // Auto-format dates
                if (['FECHA OPER.', 'FECHA VALOR'].includes(header)) {
                    if (/^\d{2}-\d{2}$/.test(val)) {
                        return val.replace('-', '/');
                    }
                }

                return val;
            });
            newData.push(newRow);
        }
        setPreviewData(newData);
    };

    const handleExport = () => {
        if (selectedHeaders.length === 0) {
            alert('Por favor selecciona al menos una columna para exportar.');
            return;
        }

        exportToExcel(previewData, `${file.name.replace('.pdf', '')}.xlsx`);
        setStep(3);
    };

    return (
        <div className="animate-fade-in">
            <header style={{ textAlign: 'center', marginBottom: '3rem' }}>
                <h1 className="title">PDF to Excel</h1>
                <p className="subtitle">Extracción Inteligente de Estados de Cuenta</p>
            </header>

            <div className="glass-card" style={{ position: 'relative', overflow: 'hidden' }}>
                {loading && <div className="scanning-line" />}

                {step === 1 && (
                    <div className="upload-section">
                        <label className="dropzone">
                            <input type="file" accept=".pdf" onChange={handleFileUpload} style={{ display: 'none' }} disabled={loading} />
                            {loading ? (
                                <>
                                    <div className="spinner" />
                                    <p style={{ fontSize: '1.25rem', fontWeight: '500', marginTop: '1rem' }}>
                                        {tables.length > 0 ? `¡Encontradas ${tables.length} tablas!` : 'Analizando estructuras...'}
                                    </p>
                                </>
                            ) : (
                                <>
                                    <Upload size={48} color="var(--primary)" />
                                    <p style={{ fontSize: '1.25rem', fontWeight: '500' }}>
                                        Cargar Estado de Cuenta
                                    </p>
                                    <p className="subtitle">Arrastra tu PDF aquí o haz clic para explorar</p>
                                </>
                            )}
                        </label>
                        {processingError && (
                            <div style={{ marginTop: '1.5rem', color: '#f87171', display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '1rem', borderRadius: '0.75rem' }}>
                                <AlertCircle size={20} />
                                <span style={{ fontWeight: '500' }}>{processingError}</span>
                            </div>
                        )}
                    </div>
                )}

                {step === 2 && (
                    <div className="preview-section animate-fade-in">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <div>
                                <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                                    <FileSpreadsheet size={24} color="var(--primary)" />
                                    1. Selecciona las Tablas
                                </h2>
                                <p className="subtitle" style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem' }}>
                                    Selecciona las tablas que deseas incluir en tu Excel
                                </p>
                            </div>
                            <div className="btn" style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-dim)', cursor: 'default', border: '1px solid var(--glass-border)' }}>
                                {selectedTables.length} de {tables.length} seleccionadas
                            </div>
                        </div>

                        <div className="table-gallery">
                            {tables.map((table, idx) => (
                                <div
                                    key={idx}
                                    className={`table-card ${selectedTables.includes(idx) ? 'selected' : ''}`}
                                    onClick={() => setSelectedTables(prev => prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx])}
                                >
                                    <div className="select-indicator">
                                        <CheckCircle2 size={20} />
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                        <div style={{ padding: '0.5rem', background: 'rgba(99, 102, 241, 0.15)', borderRadius: '8px', color: 'var(--primary)' }}>
                                            <FileSpreadsheet size={18} />
                                        </div>
                                        <span style={{ fontWeight: '600', fontSize: '0.95rem', color: 'var(--text)' }}>Tabla {idx + 1}</span>
                                    </div>
                                    <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                                        {table.rows.length} filas detectadas en Pág. {table.page}
                                    </p>

                                    <div style={{ marginTop: '0.5rem' }}>
                                        <p style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--primary)', fontWeight: '700', marginBottom: '0.4rem' }}>
                                            Cabeceras (Vista Previa):
                                        </p>
                                        <div className="card-header-preview">
                                            {table.rows[0]?.slice(0, 4).map((h, i) => (
                                                <span key={i} className="header-tag">{h}</span>
                                            ))}
                                            {table.rows[0]?.length > 4 && <span className="header-tag">...</span>}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div style={{ marginTop: '3rem', paddingTop: '1.5rem', borderTop: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'flex-end', gap: '1.5rem', alignItems: 'center' }}>
                            <button className="btn" onClick={() => setStep(1)}>
                                Atrás
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={goToHeaderSelection}
                                disabled={selectedTables.length === 0}
                                style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem 2.5rem', opacity: selectedTables.length === 0 ? 0.5 : 1 }}
                            >
                                Continuar a Cabeceras <ChevronRight size={20} />
                            </button>
                        </div>
                    </div>
                )}

                {step === 2.5 && (
                    <div className="header-selection animate-fade-in">
                        <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            <CheckCircle2 size={24} color="var(--primary)" />
                            2. Selecciona las Columnas
                        </h2>
                        <p className="subtitle" style={{ marginBottom: '2rem' }}>Elige las cabeceras que quieres incluir en el archivo Excel final</p>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', background: 'rgba(0, 0, 0, 0.3)', padding: '2rem', borderRadius: '16px', border: '1px solid var(--glass-border)' }}>
                            {availableHeaders.map((header, idx) => (
                                <label key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem', background: selectedHeaders.includes(header) ? 'rgba(99, 102, 241, 0.1)' : 'rgba(255, 255, 255, 0.02)', borderRadius: '12px', border: '1px solid', borderColor: selectedHeaders.includes(header) ? 'var(--primary)' : 'var(--glass-border)', cursor: 'pointer', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)', boxShadow: selectedHeaders.includes(header) ? '0 0 15px rgba(99, 102, 241, 0.15)' : 'none' }}>
                                    <input type="checkbox" checked={selectedHeaders.includes(header)} onChange={() => setSelectedHeaders(prev => prev.includes(header) ? prev.filter(h => h !== header) : [...prev, header])} style={{ accentColor: 'var(--primary)', width: '18px', height: '18px' }} />
                                    <span style={{ fontSize: '0.95rem', fontWeight: '500', color: selectedHeaders.includes(header) ? 'white' : 'var(--text-dim)' }}>{header}</span>
                                </label>
                            ))}
                        </div>

                        <div style={{ marginTop: '3rem', display: 'flex', justifyContent: 'flex-end', gap: '1.5rem' }}>
                            <button className="btn" onClick={() => setStep(2)}>Atrás</button>
                            <button className="btn btn-primary" onClick={goToFinalPreview} disabled={selectedHeaders.length === 0} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                Revisar Datos <ChevronRight size={20} />
                            </button>
                        </div>
                    </div>
                )}

                {step === 2.8 && (
                    <div className="final-preview animate-fade-in">
                        <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            <FileSpreadsheet size={24} color="var(--primary)" />
                            3. Vista Previa y Formato
                        </h2>
                        <p className="subtitle" style={{ marginBottom: '2rem' }}>Revisa y edita los datos directamente en la tabla antes de exportar</p>

                        <div className="spreadsheet-container">
                            <table className="spreadsheet-table">
                                <thead>
                                    <tr>
                                        {previewData[0]?.map((header, idx) => (
                                            <th key={idx}>{header}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {previewData.slice(1).map((row, rowIndex) => (
                                        <tr key={rowIndex}>
                                            {row.map((cell, colIndex) => (
                                                <td key={colIndex}>
                                                    <input
                                                        className="editable-cell"
                                                        value={cell}
                                                        onChange={(e) => updateCell(rowIndex + 1, colIndex, e.target.value)}
                                                    />
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div style={{ marginTop: '3rem', display: 'flex', justifyContent: 'flex-end', gap: '1.5rem', flexWrap: 'wrap' }}>
                            <button className="btn" onClick={() => setStep(2.5)}>Atrás</button>
                            <button className="btn" onClick={autoFormatData} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(168, 85, 247, 0.15)', color: '#d8b4fe', border: '1px solid rgba(168,85,247,0.3)', boxShadow: '0 0 15px rgba(168, 85, 247, 0.1)' }}>
                                Auto-Formato Mágico <Wand2 size={20} />
                            </button>
                            <button className="btn btn-primary" onClick={handleExport} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '1rem 3rem' }}>
                                ¡Todo listo! Descargar Excel <Download size={20} />
                            </button>
                        </div>
                    </div>
                )}

                {step === 3 && (
                    <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                        <div style={{ marginBottom: '1.5rem', display: 'inline-flex', padding: '1.5rem', borderRadius: '50%', background: 'rgba(34, 197, 94, 0.15)', border: '1px solid rgba(34, 197, 94, 0.3)', boxShadow: '0 0 30px rgba(34, 197, 94, 0.2)' }}>
                            <CheckCircle2 size={64} color="#4ade80" />
                        </div>
                        <h2 style={{ fontSize: '2rem', marginBottom: '1rem' }}>¡Exportación Exitosa!</h2>
                        <p className="subtitle" style={{ marginBottom: '2rem' }}>
                            Tu archivo de Excel se ha generado correctamente.
                        </p>
                        <button className="btn btn-primary" onClick={() => setStep(1)}>
                            Convertir otro archivo
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;
