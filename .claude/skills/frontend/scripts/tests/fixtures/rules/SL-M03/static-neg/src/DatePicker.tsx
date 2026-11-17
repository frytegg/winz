const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];

export function DatePicker() {
  return (
    <form>
      <select>
        <option value="01">January</option>
        <option value="02">February</option>
        <option value="03">March</option>
      </select>
      <p>Step 1 of 3</p>
      <p>Step 2 of 3</p>
      <p>Step 3 of 3</p>
    </form>
  );
}

export const pad = (d: Date) => String(d.getMonth() + 1).padStart(2, '0');
export const count = months.length;
