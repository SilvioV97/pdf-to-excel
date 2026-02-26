import * as XLSX from 'xlsx';

/**
 * Exports data to an Excel file.
 */
export function exportToExcel(data, fileName = 'exported_data.xlsx') {
    // data should be an array of arrays or array of objects
    const worksheet = XLSX.utils.aoa_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");

    // Create a blob and trigger download
    XLSX.writeFile(workbook, fileName);
}
