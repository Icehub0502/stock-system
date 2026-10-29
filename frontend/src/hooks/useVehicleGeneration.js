import { useCallback, useEffect, useRef, useState } from 'react';
import client from '../api/client';

// The vehicle generation ("Vios ปี '13-22'") of a customer's car, which decides the standard prices that apply
// (see backend/src/routes/modelPrices.routes.js). Looks the generation up from the car's stored generation or from
// its brand + model text: exactly one match = known, several = the staff choose (modelChoices), none = the staff
// search the book. A generation that is found or chosen is saved on the car, so it is asked only once.
//   vehicleModel   : { id, brand, model, year_range, display_name } | null
//   lookupStandard : (modelId, itemName) → { part_price, labor_price, is_set } | null (cached per generation + name)
export default function useVehicleGeneration({ vehicleId, vehicleModelId, brand, model }) {
  const [vehicleModel, setVehicleModel] = useState(null);
  const [modelChoices, setModelChoices] = useState([]);
  const [resolving, setResolving] = useState(false);
  const [previousModel, setPreviousModel] = useState(null); // the generation before "change model", to cancel back to
  const pickedKey = useRef(null);
  const resolveSeq = useRef(0);
  const stdCache = useRef(new Map());

  const carKey = `${vehicleId}|${vehicleModelId || ''}|${brand || ''}|${model || ''}`;

  const attach = useCallback((modelId) => {
    if (!vehicleId) return;
    client.post('/model-prices/attach-vehicle', { vehicle_id: Number(vehicleId), vehicle_model_id: modelId }).catch(() => {});
  }, [vehicleId]);

  useEffect(() => {
    if (!vehicleId || pickedKey.current === carKey) return undefined;
    const seq = resolveSeq.current + 1;
    resolveSeq.current = seq;
    setResolving(true);
    const timer = setTimeout(async () => {
      try {
        let matches = [];
        if (vehicleModelId) {
          const res = await client.get('/model-prices/resolve', { params: { vehicle_model_id: vehicleModelId } });
          matches = res.data.data.matches;
        }
        const storedMatch = matches.length === 1;
        if (matches.length === 0 && (brand || '').trim() && (model || '').trim()) {
          const res = await client.get('/model-prices/resolve', { params: { brand: brand.trim(), model: model.trim() } });
          matches = res.data.data.matches;
        }
        if (seq !== resolveSeq.current) return;
        setVehicleModel(matches.length === 1 ? matches[0] : null);
        setModelChoices(matches.length > 1 ? matches : []);
        // the generation named by the text is saved on the car, so the draft can remember prices under it later
        if (matches.length === 1 && !storedMatch) attach(matches[0].id);
      } catch (err) {
        console.error('Error resolving the vehicle generation:', err);
        if (seq === resolveSeq.current) {
          setVehicleModel(null);
          setModelChoices([]);
        }
      } finally {
        if (seq === resolveSeq.current) setResolving(false);
      }
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carKey]);

  // the cache belongs to one generation
  useEffect(() => { stdCache.current.clear(); }, [vehicleModel?.id]);

  const pick = (picked) => {
    pickedKey.current = carKey;
    setVehicleModel(picked);
    setModelChoices([]);
    setPreviousModel(null);
    attach(picked.id);
  };

  const clear = () => {
    pickedKey.current = carKey;
    setPreviousModel(vehicleModel);
    setVehicleModel(null);
    setModelChoices([]);
  };

  // cancel "change model": back to the generation the car had
  const restore = () => {
    setVehicleModel(previousModel);
    setPreviousModel(null);
  };

  const lookupStandard = async (modelId, name) => {
    const key = `${modelId}|${String(name).trim().toLowerCase()}`;
    if (stdCache.current.has(key)) return stdCache.current.get(key);
    try {
      const res = await client.get('/model-prices/lookup', { params: { vehicle_model_id: modelId, name } });
      stdCache.current.set(key, res.data.data);
      return res.data.data;
    } catch (err) {
      console.error('Error looking up the standard price:', err);
      return null;
    }
  };

  const forgetStandards = () => stdCache.current.clear();

  return { vehicleModel, modelChoices, resolving, previousModel, pick, clear, restore, lookupStandard, forgetStandards };
}
