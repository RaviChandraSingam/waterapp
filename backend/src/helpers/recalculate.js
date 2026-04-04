const db = require('../db');

/**
 * Recalculates cost_per_litre, total_water_input, total_water_usage
 * and flat billing for a monthly record.
 * Called after Excel import and from the /calculate endpoint.
 */
async function recalculateMonthlyRecord(recordId) {
  // Get billing config
  const config = await db.query('SELECT * FROM billing_config');
  const configMap = {};
  config.rows.forEach(c => { configMap[c.config_key] = parseFloat(c.config_value); });

  const slab1Limit = configMap.slab1_limit || 15000;
  const slab2Limit = configMap.slab2_limit || 20000;
  const slab1Mult = configMap.slab1_multiplier || 1.0;
  const slab2Mult = configMap.slab2_multiplier || 1.5;
  const slab3Mult = configMap.slab3_multiplier || 2.0;

  // Total cost = cost_items + water source totals
  const costItems = await db.query(
    'SELECT SUM(amount) as total FROM cost_items WHERE monthly_record_id = $1',
    [recordId]
  );
  const waterSourceReadings = await db.query(
    'SELECT SUM(total_cost) as tanker_cost FROM water_source_readings WHERE monthly_record_id = $1',
    [recordId]
  );

  const itemsCost = parseFloat(costItems.rows[0].total || 0);
  const tankerCost = parseFloat(waterSourceReadings.rows[0].tanker_cost || 0);
  const totalCost = itemsCost + tankerCost;

  // Total water input = sum of all source consumption
  const inputResult = await db.query(
    'SELECT SUM(consumption_litres) as total FROM water_source_readings WHERE monthly_record_id = $1',
    [recordId]
  );
  const totalInput = parseFloat(inputResult.rows[0].total || 0);

  const costPerLitre = totalInput > 0 ? totalCost / totalInput : 0;

  // Calculate flat billing
  const readings = await db.query(`
    SELECT flat_id,
      MIN(CASE WHEN reading_sequence = 1 THEN reading_value END) as start_reading,
      MAX(CASE WHEN reading_sequence = 3 THEN reading_value
           WHEN reading_sequence = 2 THEN reading_value END) as end_reading
    FROM meter_readings
    WHERE monthly_record_id = $1
    GROUP BY flat_id
  `, [recordId]);

  let totalUsage = 0;
  for (const r of readings.rows) {
    const startReading = parseFloat(r.start_reading || 0);
    const endReading = parseFloat(r.end_reading || 0);
    const consumption = (endReading - startReading) * 1000;
    totalUsage += consumption;

    const slab1Qty = Math.min(consumption, slab1Limit);
    const slab2Qty = consumption > slab2Limit
      ? (slab2Limit - slab1Limit)
      : Math.max(0, consumption - slab1Limit);
    const slab3Qty = Math.max(0, consumption - slab2Limit);

    const slab1Cost = slab1Qty * costPerLitre * slab1Mult;
    const slab2Cost = slab2Qty * costPerLitre * slab2Mult;
    const slab3Cost = slab3Qty * costPerLitre * slab3Mult;
    const flatTotalCost = slab1Cost + slab2Cost + slab3Cost;

    await db.query(`
      INSERT INTO flat_billing (monthly_record_id, flat_id, start_reading, end_reading,
        consumption_litres, slab1_qty, slab2_qty, slab3_qty, slab1_cost, slab2_cost, slab3_cost, total_cost)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (monthly_record_id, flat_id)
      DO UPDATE SET start_reading = $3, end_reading = $4, consumption_litres = $5,
        slab1_qty = $6, slab2_qty = $7, slab3_qty = $8,
        slab1_cost = $9, slab2_cost = $10, slab3_cost = $11, total_cost = $12, updated_at = NOW()
    `, [recordId, r.flat_id, startReading, endReading, consumption,
        slab1Qty, slab2Qty, slab3Qty,
        Math.round(slab1Cost * 100) / 100,
        Math.round(slab2Cost * 100) / 100,
        Math.round(slab3Cost * 100) / 100,
        Math.round(flatTotalCost * 100) / 100]);
  }

  // Common area consumption
  const commonReadings = await db.query(
    'SELECT * FROM common_area_readings WHERE monthly_record_id = $1',
    [recordId]
  );
  let commonTotal = 0;
  for (const cr of commonReadings.rows) {
    const consumption = (parseFloat(cr.end_reading) - parseFloat(cr.start_reading)) * 1000;
    commonTotal += consumption;
    await db.query(
      'UPDATE common_area_readings SET consumption_litres = $1 WHERE id = $2',
      [consumption, cr.id]
    );
  }

  totalUsage += commonTotal;

  // Update monthly record summary fields
  await db.query(`
    UPDATE monthly_records
    SET cost_per_litre = $1, total_water_input = $2, total_water_usage = $3, updated_at = NOW()
    WHERE id = $4
  `, [costPerLitre, totalInput, totalUsage, recordId]);

  return {
    costPerLitre: Math.round(costPerLitre * 1000000) / 1000000,
    totalCost: Math.round(totalCost * 100) / 100,
    totalWaterInput: totalInput,
    totalWaterUsage: totalUsage,
    flatsCalculated: readings.rows.length,
  };
}

module.exports = { recalculateMonthlyRecord };
