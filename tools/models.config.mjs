/**
 * Which downloaded models go into the game and how (see tools/prep-models.mjs).
 *
 * - src: folder in assets/incoming (model.glb inside); node: take only this subtree (packs).
 * - group: what the game asks for (car, van, police, ambulance, wreck, tank, apc, truck, heli, prop names).
 * - length: target length (m) along the longest horizontal axis; omit to keep the model's own size.
 * - flip: the nose came out pointing −X after the automatic turn; turn it 180°.
 * - budget: triangle budget after simplification (cars 3–6k: fewer cars on screen beats torn ones).
 * - tint: true = the game may repaint it (multiplies the texture), false = keep the livery.
 * - recolor: strong reds become this color (no red-cross emblems, no red splashes that read as blood).
 *
 * Not used: V1 (a storage tank, not a military one); H1, V2, V8, V10, V12, C7, C10 (not downloaded); "Yellow Taxi/Cab - PS1 Car" (CC BY-SA, not allowed);
 * from V5 the UAZ, Ural and Tiger (real car brands). Humans (H2–H4) wait for the 9.3 decision.
 */
export const MODELS = [
  // Civilian cars.
  { src: 'C1_thunderbolt', name: 'sedan_thunderbolt', recolor: [40, 62, 110], group: 'car', length: 4.7, budget: 4000, tint: true },
  { src: 'C2_kiri', name: 'sedan_kiri', group: 'car', length: 4.6, budget: 4000, tint: true },
  { src: 'C3_psx_sedan', name: 'sedan_psx', group: 'car', length: 4.6, budget: 4000, tint: true },
  { src: 'C4_small_car', name: 'small_car', group: 'car', length: 3.8, budget: 4000, tint: true },
  { src: 'C6_pickup', name: 'pickup', group: 'car', length: 5.3, budget: 4000, tint: true },
  { src: 'C16_car_pack', name: 'coupe', group: 'car', length: 4.4, budget: 4000, tint: true },
  { src: 'C17_traffic_pack', node: 'Car_1', name: 'traffic_1', flip: true, group: 'car', length: 4.6, budget: 4000, tint: true },
  { src: 'C17_traffic_pack', node: 'Car_2', name: 'traffic_2', flip: true, group: 'car', length: 4.3, budget: 4000, tint: true },
  { src: 'C17_traffic_pack', node: 'Car_3', name: 'traffic_3', flip: true, group: 'car', length: 4.4, budget: 4000, tint: true },
  { src: 'C17_traffic_pack', node: 'Car_4', name: 'traffic_4', flip: true, group: 'car', length: 3.9, budget: 4000, tint: true },
  { src: 'C17_traffic_pack', node: 'Car_5', name: 'traffic_5', flip: true, group: 'car', length: 4.5, budget: 4000, tint: true },
  // Vans.
  { src: 'C8_french_van', name: 'van_delivery', flip: true, group: 'van', length: 4.8, budget: 4000, tint: true },
  { src: 'C9_transport_van', name: 'van_transport', group: 'van', length: 5.0, budget: 4000, tint: true },
  { src: 'V7_white_van', name: 'van_white', group: 'van', length: 5.0, budget: 4000, tint: true },
  // Services.
  { src: 'C11_chapman_cop', name: 'police_cruiser', group: 'police', length: 5.1, budget: 5000, tint: false },
  { src: 'C12_police_car', name: 'police_car', group: 'police', length: 4.7, budget: 5000, tint: false },
  { src: 'V6_police_suv', name: 'police_suv', group: 'police', length: 4.9, budget: 5000, tint: false },
  { src: 'V9_ambulance', name: 'ambulance', flip: true, group: 'ambulance', length: 5.6, budget: 5000, tint: false },
  { src: 'C14_ambulance_drcg', name: 'ambulance_2', recolor: [40, 130, 70], group: 'ambulance', length: 5.6, budget: 5000, tint: false },
  { src: 'C15_wreck', name: 'wreck', group: 'wreck', length: 4.6, budget: 5000, tint: false },
  // Military.
  { src: 'V5_military_pack', node: 'T-90', name: 'tank', group: 'tank', budget: 2000, tint: false },
  { src: 'V5_military_pack', node: 'BTR', name: 'apc', group: 'apc', budget: 2000, tint: false },
  { src: 'V3_military_truck', name: 'army_truck', flip: true, group: 'truck', length: 7.0, budget: 2000, tint: false },
  { src: 'V4_army_truck', name: 'army_truck_2', group: 'truck', length: 7.0, budget: 2000, tint: false },
  { src: 'V11_helicopter', name: 'helicopter', group: 'heli', length: 12.0, budget: 2500, tint: false },
  // Props.
  { src: 'P1_sandbag_realist', name: 'sandbag', group: 'sandbag', length: 0.75, budget: 120, tint: false },
  { src: 'P2_sandbag', name: 'sandbag_2', group: 'sandbag', length: 0.75, budget: 120, tint: false },
  { src: 'P3_concrete_barrier', name: 'jersey', group: 'jersey', length: 2.0, budget: 200, tint: false },
  { src: 'P4_barrier_pack', node: 'Object_5', name: 'barrier_a', group: 'barrier', budget: 400, tint: false },
  { src: 'P4_barrier_pack', node: 'Object_6', name: 'barrier_b', group: 'barrier', budget: 400, tint: false },
  { src: 'P4_barrier_pack', node: 'Object_3', name: 'barrier_low', group: 'barrier', budget: 400, tint: false },
  { src: 'P4_barrier_pack', node: 'Object_7', name: 'cone_block', group: 'cone', budget: 400, tint: false },
  { src: 'P4_barrier_pack', node: 'Object_9', name: 'cone', group: 'cone', budget: 300, tint: false },
  { src: 'P5_barricade', name: 'barricade', group: 'barricade', length: 2.2, budget: 800, tint: false },
  { src: 'P6_military_tent', name: 'tent_military', group: 'tent', length: 6.5, budget: 2500, tint: false },
  { src: 'P7_medical_tent', name: 'tent_medical', recolor: [40, 130, 70], group: 'tent_medical', length: 4.5, budget: 1200, tint: false },
  { src: 'P8_stretcher', name: 'stretcher', group: 'stretcher', length: 2.0, budget: 700, tint: false },
];
