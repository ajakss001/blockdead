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
  // Aircraft (POI stage 4: the airport, the military base).
  { src: 'A1_passenger_aircraft', name: 'airliner', flip: true, group: 'airliner', length: 34, budget: 3000, tint: false },
  { src: 'A2_light_plane', name: 'light_plane', group: 'lightplane', length: 8.3, budget: 2000, tint: false },
  { src: 'A3_fighter_jet', name: 'fighter_jet', group: 'fighter', length: 15.5, budget: 1200, tint: false },
  { src: 'A4_huey', name: 'huey', group: 'heliMil', length: 17.4, budget: 2500, tint: false },
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

  // Custom Meshy 3D interior & street props (newmodel.zip).
  { src: 'meshy_pack/Meshy_AI_Electronic_Keypad_20261114_texture_eb7896d4', file: 'Meshy_AI_model.glb', name: 'meshy_keypad', group: 'keypad', height: 0.24, budget: 600, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Heavy_Industrial_Door_20261114_texture_8d5650a4', file: 'Meshy_AI_model.glb', name: 'meshy_lab_door', group: 'labDoor', height: 2.1, budget: 1400, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Industrial_Metal_Shelf_20261114_texture_f05b1f14', file: 'Meshy_AI_model.glb', name: 'meshy_metal_shelf', group: 'metalShelf', height: 1.9, budget: 1600, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Kitchen_Sink_Counter_20261114_texture_8363eca4', file: 'Meshy_AI_model.glb', name: 'meshy_kitchen_counter', group: 'kitchenCounter', height: 1.15, budget: 1500, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Metal_Locker_20261114_texture_76212984', file: 'Meshy_AI_model.glb', name: 'meshy_locker', group: 'locker', height: 2.0, budget: 1200, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Metal_Prep_Table_20261114_texture_8f951512', file: 'Meshy_AI_model.glb', name: 'meshy_lab_table', group: 'labTable', width: 1.65, budget: 1200, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_PostApoc_Worn_Desk_20261113_texture_bf09cc89', file: 'Meshy_AI_model.glb', name: 'meshy_desk', group: 'desk', width: 1.55, budget: 1400, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Radioactive_Barrel_20261114_texture_b3c2bf0d', file: 'Meshy_AI_model.glb', name: 'meshy_barrel', group: 'barrel', height: 0.92, budget: 900, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Retro_Fridge_20261114_texture_5dc39c41', file: 'Meshy_AI_model.glb', name: 'meshy_fridge', group: 'fridge', height: 2.05, budget: 1200, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Supply_Crate_20261114_texture_717596dd', file: 'Meshy_AI_model.glb', name: 'meshy_supply_crate', group: 'supplyCrate', width: 0.85, budget: 900, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Wall_Cabinet_20261114_texture_25bafd78', file: 'Meshy_AI_model.glb', name: 'meshy_wall_cabinet', group: 'wallCabinet', width: 1.2, budget: 900, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_Barricaded_Door_20261114_texture_eda8b7ac', file: 'Meshy_AI_model.glb', name: 'meshy_barricaded_door', group: 'barricadedDoor', height: 2.05, budget: 1200, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_Bookcase_20261114_texture_dba824d5', file: 'Meshy_AI_model.glb', name: 'meshy_bookcase', group: 'bookcase', height: 1.95, budget: 1600, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_Brick_Wall_Barrier_20261114_texture_2975c987', file: 'Meshy_AI_model.glb', name: 'meshy_wall_barrier', group: 'wallBarrier', width: 2.4, budget: 900, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_CRT_Television_20261114_texture_ae0b2916', file: 'Meshy_AI_model.glb', name: 'meshy_tv', group: 'tv', height: 0.52, budget: 800, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_Cast_Iron_Skillet_20261114_texture_33d874aa', file: 'Meshy_AI_model.glb', name: 'meshy_skillet', group: 'skillet', width: 0.38, budget: 500, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_Ceramic_Mug_20261114_texture_a376d87b', file: 'Meshy_AI_model.glb', name: 'meshy_mug', group: 'mug', height: 0.11, budget: 400, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_Ceramic_Plate_20261114_texture_d74bc6a2', file: 'Meshy_AI_model.glb', name: 'meshy_plate', group: 'plate', width: 0.25, layFlat: true, budget: 350, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_Checkout_Counter_20261114_texture_98c18837', file: 'Meshy_AI_model.glb', name: 'meshy_checkout', group: 'checkout', width: 1.8, budget: 1500, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_Crates_on_Pallet_20261114_texture_f069cf53', file: 'Meshy_AI_model.glb', name: 'meshy_pallet_crates', group: 'palletCrates', width: 1.2, budget: 1200, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_Dumpster_20261114_texture_596b3594', file: 'Meshy_AI_model.glb', name: 'meshy_dumpster', group: 'dumpster', width: 1.8, budget: 1200, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_Elevator_Doors_20261114_texture_c10df5db', file: 'Meshy_AI_model.glb', name: 'meshy_elevator_doors', group: 'elevatorDoors', height: 2.2, budget: 1100, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_Fabric_Sofa_20261114_texture_a9033d92', file: 'Meshy_AI_model.glb', name: 'meshy_sofa', group: 'sofa', width: 2.2, budget: 1600, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_Framed_Painting_20261114_texture_e9cf3274', file: 'Meshy_AI_model.glb', name: 'meshy_painting', group: 'painting', width: 0.85, budget: 500, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_Grocery_Shelf_20261114_texture_cd227601', file: 'Meshy_AI_model.glb', name: 'meshy_grocery_shelf', group: 'groceryShelf', width: 2.0, budget: 1800, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_Guard_Booth_20261114_texture_867b43f8', file: 'Meshy_AI_model.glb', name: 'meshy_guard_booth', group: 'guardBooth', height: 2.45, budget: 1500, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_Nightstand_20261114_texture_90ab5f25', file: 'Meshy_AI_model.glb', name: 'meshy_nightstand', group: 'nightstand', height: 0.62, budget: 900, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_Pharmacy_Shelf_20261114_texture_fea904a2', file: 'Meshy_AI_model.glb', name: 'meshy_pharmacy_shelf', group: 'pharmacyShelf', width: 1.8, budget: 1800, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_Reception_Desk_20261114_texture_00989381', file: 'Meshy_AI_model.glb', name: 'meshy_reception_desk', group: 'receptionDesk', width: 2.2, budget: 1600, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_Shopping_Cart_20261114_texture_984d0c32', file: 'Meshy_AI_model.glb', name: 'meshy_shopping_cart', group: 'shoppingCart', height: 0.98, budget: 1500, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_Stacked_Boxes_20261114_texture_144589b4', file: 'Meshy_AI_model.glb', name: 'meshy_stacked_boxes', group: 'stackedBoxes', width: 1.1, budget: 1000, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_Storage_Rack_20261114_texture_e6371b02', file: 'Meshy_AI_model.glb', name: 'meshy_storage_rack', group: 'storageRack', height: 1.9, budget: 1600, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_TV_Stand_20261114_texture_baf3ce81', file: 'Meshy_AI_model.glb', name: 'meshy_tv_stand', group: 'tvStand', width: 1.38, budget: 1000, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_Table_Lamp_20261114_texture_1953e0e3', file: 'Meshy_AI_model.glb', name: 'meshy_table_lamp', group: 'tableLamp', height: 0.45, budget: 600, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_Vintage_Suitcase_20261114_texture_f0c2b961', file: 'Meshy_AI_model.glb', name: 'meshy_suitcase', group: 'suitcase', height: 0.65, budget: 800, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_Wardrobe_with_Clothes_20261114_texture_fb8d8170', file: 'Meshy_AI_model.glb', name: 'meshy_wardrobe_open', group: 'wardrobeOpen', height: 2.12, budget: 1600, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_Wooden_Bed_20261114_texture_dca1774e', file: 'Meshy_AI_model.glb', name: 'meshy_bed', group: 'bed', depth: 2.2, budget: 1800, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_Wooden_Chair_20261114_texture_8ff7e180', file: 'Meshy_AI_model.glb', name: 'meshy_chair', group: 'chair', height: 0.98, budget: 1000, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_Wooden_Coffee_Table_20261114_texture_bde5c9fd', file: 'Meshy_AI_model.glb', name: 'meshy_coffee_table', group: 'coffeeTable', width: 1.15, budget: 1000, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_Wooden_Crate_20261114_texture_d293e66b', file: 'Meshy_AI_model.glb', name: 'meshy_wooden_crate', group: 'woodenCrate', width: 0.85, budget: 800, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_Wooden_Door_20261114_texture_355564ac', file: 'Meshy_AI_model.glb', name: 'meshy_wooden_door', group: 'woodenDoor', height: 2.1, standUp: true, budget: 1000, noTurn: true, postApoc: true, tint: false },
  { src: 'meshy_pack/Meshy_AI_Worn_Wooden_Wardrobe_20261114_texture_67da29aa', file: 'Meshy_AI_model.glb', name: 'meshy_wardrobe', group: 'wardrobe', height: 2.12, budget: 1200, noTurn: true, postApoc: true, tint: false },
];
