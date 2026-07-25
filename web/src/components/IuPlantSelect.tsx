const IU_PLANT_OPTIONS = ["IU Plant 1", "IU Plant 2", "IU Plant 3", "IU Plant 4", "IU Plant 5", "IU Plant 6"];

export default function IuPlantSelect({
  value,
  onChange,
  id,
  plant,
  required = false,
  bare = false,
  label = "IU Plant",
}: {
  value: string;
  onChange: (value: string) => void;
  id: string;
  /** Nilai kolom Plant di form yang sama -- dropdown 6 pilihan hanya muncul saat ini "1101". */
  plant: string;
  required?: boolean;
  /** Jika true, render input polos saja (tanpa wrapper .field + label) supaya bisa dibungkus komponen layout lain, mis. ExcelField. */
  bare?: boolean;
  label?: string;
}) {
  const showOptions = plant.trim() === "1101";
  const listId = `${id}-options`;

  const input = (
    <>
      <input id={id} list={showOptions ? listId : undefined} value={value} onChange={(e) => onChange(e.target.value)} required={required} />
      {showOptions && (
        <datalist id={listId}>
          {IU_PLANT_OPTIONS.map((opt) => (
            <option key={opt} value={opt} />
          ))}
        </datalist>
      )}
    </>
  );

  if (bare) return input;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {input}
    </div>
  );
}
