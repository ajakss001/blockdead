export type GlbCategory = 'vehicle' | 'aviation' | 'sign' | 'infra' | 'nature' | 'prop' | 'structure';

export interface GlbSpec {
  file: string;
  category: GlbCategory;
  size: readonly [number, number, number];
  minY: number;
  lodDist: number;
  castShadow: boolean;
  dir?: 'world' | 'catastrophe';
  optional?: boolean;
}

export const GLB_WORLD_SPECS = {
  gaz_tigr_4x4_17k: { file: 'gaz_tigr_4x4_17k.glb', category: 'vehicle' as GlbCategory, size: [2.951, 3.337, 5.7] as const, minY: 0, lodDist: 170, castShadow: true },
  zsu_23_4_shilka_14k: { file: 'zsu_23_4_shilka_14k.glb', category: 'vehicle' as GlbCategory, size: [3.223, 3.88, 6.5] as const, minY: 0, lodDist: 175, castShadow: true },
  omon_swat_van_17k: { file: 'omon_swat_van_17k.glb', category: 'vehicle' as GlbCategory, size: [2.679, 3.055, 6.2] as const, minY: 0, lodDist: 170, castShadow: true },
  Police_Sedan_DPS_22k: { file: 'Police_Sedan_DPS_22k.glb', category: 'vehicle' as GlbCategory, size: [2.235, 1.768, 4.6] as const, minY: 0, lodDist: 165, castShadow: true },
  gazelle_ambulance_17k: { file: 'gazelle_ambulance_17k.glb', category: 'vehicle' as GlbCategory, size: [2.596, 3.062, 5.6] as const, minY: -0.0002, lodDist: 170, castShadow: true },
  kamaz_fire_truck_20k: { file: 'kamaz_fire_truck_20k.glb', category: 'vehicle' as GlbCategory, size: [3.12, 3.853, 8.2] as const, minY: 0.0002, lodDist: 180, castShadow: true },
  emercom_pickup_17k: { file: 'emercom_pickup_17k.glb', category: 'vehicle' as GlbCategory, size: [2.256, 2.413, 5.3] as const, minY: -0.0001, lodDist: 165, castShadow: true },
  Kamaz_6x6_25k: { file: 'Kamaz_6x6_25k.glb', category: 'vehicle' as GlbCategory, size: [3.084, 3.495, 7.8] as const, minY: 0, lodDist: 180, castShadow: true },
  paz_3205_bus_11000: { file: 'paz_3205_bus_11000.glb', category: 'vehicle' as GlbCategory, size: [2.82, 2.835, 7.2] as const, minY: 0, lodDist: 175, castShadow: true },
  UAZ_Bukhanka_22k: { file: 'UAZ_Bukhanka_22k.glb', category: 'vehicle' as GlbCategory, size: [2.246, 2.67, 4.5] as const, minY: 0.0001, lodDist: 165, castShadow: true },
  Luxury_SUV_Gelik_22k: { file: 'Luxury_SUV_Gelik_22k.glb', category: 'vehicle' as GlbCategory, size: [2.319, 2.257, 4.8] as const, minY: 0.0001, lodDist: 165, castShadow: true },
  Sport_Sedan_22k: { file: 'Sport_Sedan_22k.glb', category: 'vehicle' as GlbCategory, size: [2.108, 1.457, 4.6] as const, minY: 0, lodDist: 165, castShadow: true },
  Semi_Truck_Tractor_24: { file: 'Semi_Truck_Tractor_24.glb', category: 'vehicle' as GlbCategory, size: [3.374, 4.872, 7] as const, minY: 0, lodDist: 185, castShadow: true },
  Semi_Trailer_Cargo_20: { file: 'Semi_Trailer_Cargo_20.glb', category: 'vehicle' as GlbCategory, size: [2.897, 4.954, 12.2] as const, minY: -0.0001, lodDist: 190, castShadow: true },
  burned_car_wreck: { file: 'burned_car_wreck.glb', category: 'vehicle' as GlbCategory, size: [1.678, 1.632, 4.4] as const, minY: 0, lodDist: 160, castShadow: true },

  mi8_emercom_22k: { file: 'mi8_emercom_22k.glb', category: 'aviation' as GlbCategory, size: [12.378, 5.133, 18.2] as const, minY: -0.0005, lodDist: 220, castShadow: true },
  mi8_wreck_remesh: { file: 'mi8_wreck_remesh.glb', category: 'aviation' as GlbCategory, size: [5.382, 4.031, 15.5] as const, minY: -0.0005, lodDist: 200, castShadow: true },
  passenger_airliner_22: { file: 'passenger_airliner_22.glb', category: 'aviation' as GlbCategory, size: [28.327, 10.865, 36] as const, minY: -0.0004, lodDist: 240, castShadow: true },

  crosswalk_sign_1500: { file: 'crosswalk_sign_1500.glb', category: 'sign' as GlbCategory, size: [0.967, 2.6, 0.313] as const, minY: 0, lodDist: 85, castShadow: false },
  Sign_Bus_Stop_1500: { file: 'Sign_Bus_Stop_1500.glb', category: 'sign' as GlbCategory, size: [0.969, 2.6, 0.238] as const, minY: 0, lodDist: 85, castShadow: false },
  Sign_Give_Way_1500: { file: 'Sign_Give_Way_1500.glb', category: 'sign' as GlbCategory, size: [1.427, 2.5, 0.201] as const, minY: 0, lodDist: 85, castShadow: false },
  Sign_Main_Road_1500: { file: 'Sign_Main_Road_1500.glb', category: 'sign' as GlbCategory, size: [1.221, 2.5, 0.183] as const, minY: 0, lodDist: 85, castShadow: false },
  Sign_No_Entry_1500: { file: 'Sign_No_Entry_1500.glb', category: 'sign' as GlbCategory, size: [1.148, 2.5, 0.219] as const, minY: 0, lodDist: 85, castShadow: false },
  Sign_No_Stopping_1500: { file: 'Sign_No_Stopping_1500.glb', category: 'sign' as GlbCategory, size: [1.011, 2.5, 0.167] as const, minY: 0, lodDist: 85, castShadow: false },

  street_lamp_2000: { file: 'street_lamp_2000.glb', category: 'infra' as GlbCategory, size: [2.487, 6.2, 0.493] as const, minY: 0, lodDist: 120, castShadow: false },
  traffic_light_2500: { file: 'traffic_light_2500.glb', category: 'infra' as GlbCategory, size: [0.789, 4.29, 0.998] as const, minY: 0, lodDist: 115, castShadow: false },
  speed_bump_1000: { file: 'speed_bump_1000.glb', category: 'infra' as GlbCategory, size: [6.8, 0.09, 0.5] as const, minY: 0.0001, lodDist: 80, castShadow: false },
  Soviet_Bus_Stop_Shelt: { file: 'Soviet_Bus_Stop_Shelt.glb', category: 'infra' as GlbCategory, size: [4.8, 3.128, 2.772] as const, minY: 0, lodDist: 150, castShadow: true },

  Dead_Autumn_Tree_6000: { file: 'Dead_Autumn_Tree_6000.glb', category: 'nature' as GlbCategory, size: [6.175, 9.5, 3.891] as const, minY: 0, lodDist: 145, castShadow: true },
  Spruce_Pine_Tree_7000: { file: 'Spruce_Pine_Tree_7000.glb', category: 'nature' as GlbCategory, size: [5.61, 11.5, 5.423] as const, minY: 0, lodDist: 150, castShadow: true },
  Urban_Bush_2500: { file: 'Urban_Bush_2500.glb', category: 'nature' as GlbCategory, size: [2.204, 1.45, 1.952] as const, minY: -0.0001, lodDist: 78, castShadow: false },

  garbage_cluster_1500: { file: 'garbage_cluster_1500.glb', category: 'prop' as GlbCategory, size: [1.1, 0.809, 0.928] as const, minY: 0.0001, lodDist: 82, castShadow: false },
  Road_Debris_Cluster_2: { file: 'Road_Debris_Cluster_2.glb', category: 'prop' as GlbCategory, size: [1.344, 0.758, 1.087] as const, minY: -0.0001, lodDist: 88, castShadow: false },
  Soviet_Dumpster_3000: { file: 'Soviet_Dumpster_3000.glb', category: 'prop' as GlbCategory, size: [2, 1.935, 1.896] as const, minY: 0, lodDist: 110, castShadow: false },
  abandoned_luggage_pil: { file: 'abandoned_luggage_pil.glb', category: 'prop' as GlbCategory, size: [0.78, 0.464, 0.745] as const, minY: 0, lodDist: 72, castShadow: false },
  checkpoint_barricade: { file: 'checkpoint_barricade.glb', category: 'prop' as GlbCategory, size: [3.4, 1.983, 2.058] as const, minY: 0.0001, lodDist: 120, castShadow: true },
  quarantine_tent: { file: 'quarantine_tent.glb', category: 'prop' as GlbCategory, size: [6.2, 3.019, 4.134] as const, minY: 0.0001, lodDist: 150, castShadow: true },
  generator_light_tower: { file: 'generator_light_tower.glb', category: 'prop' as GlbCategory, size: [3.534, 4.2, 1.756] as const, minY: 0, lodDist: 130, castShadow: true },
  burn_barrel: { file: 'burn_barrel.glb', category: 'prop' as GlbCategory, size: [0.658, 0.95, 0.656] as const, minY: 0, lodDist: 90, castShadow: false },

  fire_escape_smart_top: { file: 'fire_escape_smart_top.glb', category: 'structure' as GlbCategory, size: [3.179, 3.2, 1.509] as const, minY: 0, lodDist: 105, castShadow: false },

  crashed_boeing_fuselage: { file: 'crashed_boeing_fuselage.glb', dir: 'catastrophe' as const, optional: true as const, category: 'aviation' as GlbCategory, size: [5.8, 5.2, 22.0] as const, minY: 0, lodDist: 240, castShadow: true },
  crashed_plane_wing: { file: 'crashed_plane_wing.glb', dir: 'catastrophe' as const, optional: true as const, category: 'aviation' as GlbCategory, size: [12.5, 2.8, 5.2] as const, minY: 0, lodDist: 210, castShadow: true },
  concrete_rubble_mound: { file: 'concrete_rubble_mound.glb', dir: 'catastrophe' as const, optional: true as const, category: 'structure' as GlbCategory, size: [5.2, 2.4, 4.8] as const, minY: 0, lodDist: 165, castShadow: true },
  building_breach_frame: { file: 'building_breach_frame.glb', dir: 'catastrophe' as const, optional: true as const, category: 'structure' as GlbCategory, size: [6.4, 6.2, 1.4] as const, minY: 0, lodDist: 170, castShadow: true },
  giant_trash_mound: { file: 'giant_trash_mound.glb', dir: 'catastrophe' as const, optional: true as const, category: 'prop' as GlbCategory, size: [3.6, 1.75, 2.8] as const, minY: 0, lodDist: 120, castShadow: false },
  crash_skid_trench: { file: 'crash_skid_trench.glb', dir: 'catastrophe' as const, optional: true as const, category: 'structure' as GlbCategory, size: [18.0, 0.22, 8.5] as const, minY: 0, lodDist: 210, castShadow: false },
  charred_rubble_pile: { file: 'charred_rubble_pile.glb', dir: 'catastrophe' as const, optional: true as const, category: 'structure' as GlbCategory, size: [5.4, 2.3, 4.8] as const, minY: 0, lodDist: 175, castShadow: true },
  collapsed_concrete_slab: { file: 'collapsed_concrete_slab.glb', dir: 'catastrophe' as const, optional: true as const, category: 'structure' as GlbCategory, size: [6.8, 2.4, 5.2] as const, minY: 0, lodDist: 185, castShadow: true },
  plane_debris_cluster: { file: 'plane_debris_cluster.glb', dir: 'catastrophe' as const, optional: true as const, category: 'prop' as GlbCategory, size: [3.2, 1.15, 2.6] as const, minY: 0, lodDist: 135, castShadow: false },
  emergency_gear_scatter: { file: 'emergency_gear_scatter.glb', dir: 'catastrophe' as const, optional: true as const, category: 'prop' as GlbCategory, size: [2.8, 0.95, 2.2] as const, minY: 0, lodDist: 125, castShadow: false },
  collapsed_crane_boom: { file: 'collapsed_crane_boom.glb', dir: 'catastrophe' as const, optional: true as const, category: 'structure' as GlbCategory, size: [22.0, 2.6, 2.8] as const, minY: 0, lodDist: 230, castShadow: true },
  tower_crane_cab: { file: 'tower_crane_cab.glb', dir: 'catastrophe' as const, optional: true as const, category: 'structure' as GlbCategory, size: [4.2, 5.4, 4.8] as const, minY: 0, lodDist: 220, castShadow: true },
  road_sinkhole_crater: { file: 'road_sinkhole_crater.glb', dir: 'catastrophe' as const, optional: true as const, category: 'structure' as GlbCategory, size: [14.0, 0.55, 10.5] as const, minY: 0, lodDist: 210, castShadow: false },
  fuel_barrel_cluster: { file: 'fuel_barrel_cluster.glb', dir: 'catastrophe' as const, optional: true as const, category: 'prop' as GlbCategory, size: [2.2, 1.15, 2.0] as const, minY: 0, lodDist: 140, castShadow: true },
  military_barbed_barrier: { file: 'military_barbed_barrier.glb', dir: 'catastrophe' as const, optional: true as const, category: 'structure' as GlbCategory, size: [4.6, 1.9, 2.2] as const, minY: 0, lodDist: 175, castShadow: true },
  sniper_nest_camp: { file: 'sniper_nest_camp.glb', dir: 'catastrophe' as const, optional: true as const, category: 'prop' as GlbCategory, size: [2.4, 0.85, 2.0] as const, minY: 0, lodDist: 110, castShadow: false },
} as const satisfies Record<string, GlbSpec>;

export type GlbModelId = keyof typeof GLB_WORLD_SPECS;

/** Simplified LOD1 GLBs generated in `public/models/world/lod/<id>.glb` (80-85% triangle reduction). */
export const LOD1_WORLD_MODELS: ReadonlySet<GlbModelId> = new Set<GlbModelId>([
  'gaz_tigr_4x4_17k',
  'zsu_23_4_shilka_14k',
  'omon_swat_van_17k',
  'Police_Sedan_DPS_22k',
  'gazelle_ambulance_17k',
  'kamaz_fire_truck_20k',
  'emercom_pickup_17k',
  'Kamaz_6x6_25k',
  'paz_3205_bus_11000',
  'UAZ_Bukhanka_22k',
  'Luxury_SUV_Gelik_22k',
  'Sport_Sedan_22k',
  'Semi_Truck_Tractor_24',
  'Semi_Trailer_Cargo_20',
  'burned_car_wreck',
  'mi8_emercom_22k',
  'mi8_wreck_remesh',
  'passenger_airliner_22',
  'street_lamp_2000',
  'traffic_light_2500',
  'Soviet_Bus_Stop_Shelt',
  'Dead_Autumn_Tree_6000',
  'Spruce_Pine_Tree_7000',
  'Urban_Bush_2500',
  'Road_Debris_Cluster_2',
  'Soviet_Dumpster_3000',
  'abandoned_luggage_pil',
  'checkpoint_barricade',
  'quarantine_tent',
  'generator_light_tower',
  'fire_escape_smart_top',
]);

/** Distance (m) at which LOD0 switches to simplified LOD1 (and shadow casting stops at <= 50 m). */
export function lodSwitchDistOf(id: GlbModelId): number {
  const cat = GLB_WORLD_SPECS[id].category;
  if (cat === 'aviation') return 50;
  if (cat === 'vehicle') return 48;
  if (cat === 'nature') return id === 'Urban_Bush_2500' ? 28 : 42;
  if (cat === 'structure') return 36;
  if (cat === 'infra') return id === 'Soviet_Bus_Stop_Shelt' ? 48 : 38;
  return 34;
}

/** Uniform scale baked into traffic_light_2500 (native 5.5 m -> ~4.3 m, own pole on the sidewalk). */
export const TRAFFIC_LIGHT_SCALE = 0.78;

/**
 * Per-axis scale baked into a model at load (GlbPropPool). GLB_WORLD_SPECS.size above is the RENDERED size
 * (native size ? this), so footprints/overlap checks use real dimensions.
 *  - Road debris / garbage / luggage: ~0.42-0.52 (traffic cone ? 0.7 m, passenger-car tyre).
 *  - speed_bump_1000: native 3.4 ? 0.405 ? 1.247 -> curb-to-curb 6.8 m wide, 9 cm high, 0.5 m deep.
 */
export const GLB_BASE_SCALE: Partial<Record<GlbModelId, readonly [number, number, number]>> = {
  Road_Debris_Cluster_2: [0.42, 0.42, 0.42],
  garbage_cluster_1500: [0.5, 0.5, 0.5],
  abandoned_luggage_pil: [0.52, 0.52, 0.52],
  speed_bump_1000: [6.8 / 3.4, 0.09 / 0.405, 0.5 / 1.247],
};

export interface GlbPlacement {
  id: GlbModelId;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  pitch?: number;
  roll?: number;
}

export const CIVILIAN_FALLBACK_POOL: readonly GlbModelId[] = [
  'UAZ_Bukhanka_22k',
  'burned_car_wreck',
  'emercom_pickup_17k',
  'paz_3205_bus_11000',
  'Semi_Truck_Tractor_24',
  'Police_Sedan_DPS_22k',
  'gazelle_ambulance_17k',
  'omon_swat_van_17k',
  'Sport_Sedan_22k',
  'Luxury_SUV_Gelik_22k',
];

const ROAD_SIGNS: readonly GlbModelId[] = [
  'crosswalk_sign_1500',
  'Sign_Give_Way_1500',
  'Sign_Main_Road_1500',
  'Sign_No_Entry_1500',
  'Sign_No_Stopping_1500',
];

export function pickRoadSign(r: number): GlbModelId {
  const idx = Math.min(ROAD_SIGNS.length - 1, Math.max(0, Math.floor(r * ROAD_SIGNS.length)));
  return ROAD_SIGNS[idx];
}

/** Maps semantic vehicle/aircraft/prop group names onto the 40 compressed world GLBs. */
export function pickWorldVehicle(kind: string | undefined, r: number, smashed = 0): GlbModelId {
  switch (kind) {
    case 'police':
      return 'Police_Sedan_DPS_22k';
    case 'swat':
      return 'omon_swat_van_17k';
    case 'ambulance':
      return 'gazelle_ambulance_17k';
    case 'fireTruck':
      return 'kamaz_fire_truck_20k';
    case 'pickup':
      return 'emercom_pickup_17k';
    case 'suv':
      return 'Luxury_SUV_Gelik_22k';
    case 'van':
      return r < 0.45 ? 'UAZ_Bukhanka_22k' : r < 0.78 ? 'omon_swat_van_17k' : 'gazelle_ambulance_17k';
    case 'bus':
      return 'paz_3205_bus_11000';
    case 'semi':
      return 'Semi_Truck_Tractor_24';
    case 'trailer':
      return 'Semi_Trailer_Cargo_20';
    case 'truck':
      return r < 0.7 ? 'Kamaz_6x6_25k' : r < 0.85 ? 'kamaz_fire_truck_20k' : 'Semi_Truck_Tractor_24';
    case 'tank':
      return 'zsu_23_4_shilka_14k';
    case 'apc':
      return r < 0.65 ? 'gaz_tigr_4x4_17k' : 'omon_swat_van_17k';
    case 'wreck':
      return 'burned_car_wreck';
    case 'heli':
    case 'heliMil':
      return 'mi8_wreck_remesh';
    case 'airliner':
    case 'lightplane':
      return 'passenger_airliner_22';
    case 'fighter':
      return 'zsu_23_4_shilka_14k';
    default: {
      if (smashed > 0.6 && r < 0.50) return 'burned_car_wreck';
      if (r < 0.05) return 'Luxury_SUV_Gelik_22k';
      if (r < 0.11) return 'Sport_Sedan_22k';
      if (r < 0.43) return 'UAZ_Bukhanka_22k';
      if (r < 0.65) return 'burned_car_wreck';
      if (r < 0.83) return 'emercom_pickup_17k';
      if (r < 0.93) return 'paz_3205_bus_11000';
      return 'Semi_Truck_Tractor_24';
    }
  }
}
