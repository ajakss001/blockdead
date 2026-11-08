import type { GunId } from '../weapons/guns';
import type { GunPoses } from './gunPose';

/** Written by `node tools/vite-run.mjs src/debug/gunTune.ts <gun|all> [rounds] --write`: per-gun overrides of the class poses. */
export const GUN_TUNED: Partial<Record<GunId, Partial<GunPoses>>> = {
  pistol_g17: {
    hip: [
      0.16,
      -0.175,
      -0.38
    ],
    converge: 8,
    relief: 0.555,
    adsDrop: 0,
    sprint: {
      at: [
        0.155,
        -0.145,
        -0.33
      ],
      turn: [
        -1.075,
        0.225,
        0.6
      ]
    },
    wall: {
      at: [
        0.11,
        -0.075,
        -0.185
      ],
      turn: [
        1.025,
        -0.15,
        0.475
      ]
    },
    reload: {
      at: [
        0.19,
        -0.22,
        -0.355
      ],
      turn: [
        0.375,
        -0.05,
        0.425
      ]
    },
    lowered: {
      at: [
        0.17,
        -0.345,
        -0.215
      ],
      turn: [
        -0.475,
        -0.275,
        0.65
      ]
    },
    inspectA: {
      at: [
        0.06,
        -0.06,
        -0.185
      ],
      turn: [
        1,
        -0.275,
        0.35
      ]
    },
    inspectB: {
      at: [
        0.125,
        -0.23,
        -0.36
      ],
      turn: [
        1.175,
        0.775,
        -0.675
      ]
    },
    bash: {
      at: [
        0.255,
        -0.135,
        -0.595
      ],
      turn: [
        0.1,
        0.325,
        0.375
      ]
    },
    crouch: -0.015,
    pouch: [
      -0.02,
      -0.325,
      0.075
    ],
    mainRoll: -2.196,
    offRoll: 1.597,
    magRoll: 0.4,
    boltRoll: -0.15,
    loadRoll: -0.5,
    offShift: [
      0.042,
      -0.048,
      -0.043
    ],
    offTilt: -0.1,
    shoulderR: [
      0.003,
      0.046,
      -0.05
    ],
    shoulderL: [
      0.093,
      0.1,
      0.05
    ],
    adsShoulderR: [
      -0.087,
      -0.03,
      -0.086
    ],
    adsShoulderL: [
      0.096,
      0.097,
      -0.07
    ],
    adsMainRoll: -0.25,
    adsOffRoll: 0.15
  },
  shotgun_pump: {
    hip: [
      0.19,
      -0.14,
      -0.25
    ],
    converge: 12,
    relief: 0.238,
    adsDrop: 0.02,
    sprint: {
      at: [
        0.08,
        -0.26,
        -0.22
      ],
      turn: [
        -0.4,
        0.5,
        -0.25
      ]
    },
    wall: {
      at: [
        0.215,
        -0.265,
        -0.14
      ],
      turn: [
        0.325,
        -0.425,
        -0.025
      ]
    },
    reload: {
      at: [
        0.15,
        -0.215,
        -0.26
      ],
      turn: [
        0.5,
        0.213,
        0.025
      ]
    },
    lowered: {
      at: [
        0.03,
        -0.56,
        -0.015
      ],
      turn: [
        -0.6,
        0.075,
        -0.51
      ]
    },
    inspectA: {
      at: [
        0.139,
        -0.262,
        -0.225
      ],
      turn: [
        -0.2,
        -0.385,
        -0.475
      ]
    },
    inspectB: {
      at: [
        0.157,
        -0.33,
        -0.18
      ],
      turn: [
        0.075,
        -0.313,
        -0.5
      ]
    },
    bash: {
      at: [
        0.218,
        -0.35,
        -0.29
      ],
      turn: [
        0,
        0.175,
        -0.475
      ]
    },
    crouch: -0.02,
    pouch: [
      0.201,
      -0.4,
      -0.145
    ],
    mainRoll: 1.247,
    offRoll: -0.346,
    magRoll: -0.825,
    boltRoll: 0.45,
    loadRoll: 0.45,
    offShift: [
      0.01,
      -0.004,
      -0.01
    ],
    offTilt: 0.1,
    shoulderR: [
      -0.087,
      0.09,
      -0.076
    ],
    shoulderL: [
      0.005,
      0.097,
      -0.09
    ],
    adsShoulderR: [
      -0.066,
      0.075,
      -0.039
    ],
    adsShoulderL: [
      -0.097,
      0.06,
      -0.062
    ],
    adsMainRoll: 1.15,
    adsOffRoll: -0.05
  },
  rifle_hunting: {
    hip: [
      0.15,
      -0.14,
      -0.28
    ],
    converge: 12,
    relief: 0.22,
    adsDrop: 0.02,
    sprint: {
      at: [
        0.08,
        -0.26,
        -0.22
      ],
      turn: [
        -0.4,
        0.5,
        -0.25
      ]
    },
    wall: {
      at: [
        0.14,
        -0.28,
        -0.15
      ],
      turn: [
        0.55,
        -0.4,
        0
      ]
    },
    reload: {
      at: [
        0.02,
        -0.2,
        -0.25
      ],
      turn: [
        0.275,
        0,
        -0.2
      ]
    },
    lowered: {
      at: [
        0.125,
        -0.525,
        -0.06
      ],
      turn: [
        -0.075,
        0.4,
        -0.15
      ]
    },
    inspectA: {
      at: [
        0.17,
        -0.24,
        -0.21
      ],
      turn: [
        0.6,
        0.05,
        0.5
      ]
    },
    inspectB: {
      at: [
        0.165,
        -0.25,
        -0.18
      ],
      turn: [
        0.675,
        -0.2,
        0.1
      ]
    },
    bash: {
      at: [
        0.09,
        -0.33,
        -0.35
      ],
      turn: [
        0.45,
        -0.35,
        -0.25
      ]
    },
    crouch: -0.02,
    pouch: [
      0.205,
      -0.45,
      -0.195
    ],
    mainRoll: 0.698,
    offRoll: 1.197,
    magRoll: -1.55,
    boltRoll: 0.6,
    loadRoll: 1.35,
    offShift: [
      0.015,
      0,
      0.025
    ],
    offTilt: 0.05,
    shoulderR: [
      -0.017,
      0.09,
      -0.03
    ],
    shoulderL: [
      -0.1,
      0.097,
      -0.069
    ],
    adsShoulderR: [
      -0.053,
      0.09,
      -0.06
    ],
    adsShoulderL: [
      -0.08,
      0.1,
      0.06
    ],
    adsMainRoll: 0.9,
    adsOffRoll: 0.6
  },
  pistol_m1911: {
    hip: [
      0.1,
      -0.14,
      -0.43
    ],
    converge: 8,
    relief: 0.46,
    adsDrop: 0,
    sprint: {
      at: [
        0.08,
        -0.22,
        -0.31
      ],
      turn: [
        -0.9,
        0.45,
        0
      ]
    },
    wall: {
      at: [
        0.17,
        -0.09,
        -0.19
      ],
      turn: [
        0.75,
        0.15,
        0.15
      ]
    },
    reload: {
      at: [
        0.08,
        -0.11,
        -0.25
      ],
      turn: [
        0.3,
        0.35,
        -0.3
      ]
    },
    lowered: {
      at: [
        0.09,
        -0.45,
        -0.25
      ],
      turn: [
        -0.55,
        0,
        0.15
      ]
    },
    inspectA: {
      at: [
        0.08,
        -0.12,
        -0.33
      ],
      turn: [
        0.3,
        0.1,
        0.35
      ]
    },
    inspectB: {
      at: [
        0.09,
        -0.16,
        -0.39
      ],
      turn: [
        1.1,
        0.75,
        -0.35
      ]
    },
    bash: {
      at: [
        0.18,
        -0.18,
        -0.44
      ],
      turn: [
        -0.1,
        -0.2,
        0.05
      ]
    },
    crouch: -0.015,
    pouch: [
      -0.07,
      -0.5,
      -0.3
    ],
    mainRoll: 0.9,
    offRoll: -0.747,
    magRoll: -0.9,
    boltRoll: 0.6,
    loadRoll: 0.3,
    offShift: [
      0.03,
      0.015,
      0
    ],
    offTilt: -0.45,
    shoulderR: [
      0.06,
      0.04,
      0.02
    ],
    shoulderL: [
      0,
      0.08,
      0.06
    ],
    adsShoulderR: [
      -0.06,
      0.09,
      -0.06
    ],
    adsShoulderL: [
      -0.06,
      0.09,
      -0.1
    ],
    adsMainRoll: 0,
    adsOffRoll: -0.3
  },
  launcher_rpg: {
    hip: [
      0.05,
      -0.14,
      -0.127
    ],
    converge: 20,
    relief: 0.15,
    adsDrop: 0,
    sprint: {
      at: [
        0.03,
        -0.2,
        -0.1
      ],
      turn: [
        -0.8,
        0.5,
        0.138
      ]
    },
    wall: {
      at: [
        0.113,
        -0.148,
        0.011
      ],
      turn: [
        1.755,
        0.15,
        -2.052
      ]
    },
    reload: {
      at: [
        0.055,
        -0.23,
        -0.08
      ],
      turn: [
        -0.225,
        0.162,
        0.05
      ]
    },
    lowered: {
      at: [
        0.155,
        -0.5,
        -0.245
      ],
      turn: [
        -0.125,
        -0.112,
        0.638
      ]
    },
    inspectA: {
      at: [
        0.135,
        -0.305,
        -0.227
      ],
      turn: [
        -0.425,
        -0.325,
        0.325
      ]
    },
    inspectB: {
      at: [
        0.075,
        -0.255,
        -0.185
      ],
      turn: [
        -0.025,
        0.225,
        0.275
      ]
    },
    bash: {
      at: [
        0.16,
        -0.262,
        -0.28
      ],
      turn: [
        -0.35,
        -0.25,
        0.45
      ]
    },
    crouch: -0.02,
    pouch: [
      -0.528,
      -0.65,
      -0.343
    ],
    mainRoll: -1.196,
    offRoll: 2.518,
    magRoll: 0,
    boltRoll: 0.075,
    loadRoll: -1.3,
    offShift: [
      0,
      0.01,
      0.015
    ],
    offTilt: -0.15,
    shoulderR: [
      -0.068,
      0.05,
      0.09
    ],
    shoulderL: [
      -0.002,
      0.1,
      0.042
    ],
    adsShoulderR: [
      -0.023,
      0.09,
      -0.027
    ],
    adsShoulderL: [
      -0.044,
      0.097,
      -0.1
    ],
    adsMainRoll: -0.2,
    adsOffRoll: 0.54
  },
  rifle_m4a1: {
    hip: [
      0.12,
      -0.19,
      -0.2
    ],
    converge: 12,
    relief: 0.215,
    adsDrop: 0.02,
    sprint: {
      at: [
        0.08,
        -0.26,
        -0.22
      ],
      turn: [
        -0.4,
        0.5,
        -0.25
      ]
    },
    wall: {
      at: [
        0.165,
        -0.295,
        -0.1
      ],
      turn: [
        0.45,
        0.075,
        0.15
      ]
    },
    reload: {
      at: [
        0.075,
        -0.185,
        -0.125
      ],
      turn: [
        0.375,
        -0.175,
        -0.2
      ]
    },
    lowered: {
      at: [
        0.16,
        -0.47,
        -0.045
      ],
      turn: [
        -0.45,
        0.75,
        -0.275
      ]
    },
    inspectA: {
      at: [
        0.225,
        -0.17,
        -0.07
      ],
      turn: [
        0.2,
        -0.125,
        0.425
      ]
    },
    inspectB: {
      at: [
        0.21,
        -0.265,
        -0.18
      ],
      turn: [
        0.3,
        0.325,
        0.1
      ]
    },
    bash: {
      at: [
        0.155,
        -0.21,
        -0.395
      ],
      turn: [
        -0.2,
        0.325,
        -0.025
      ]
    },
    crouch: -0.02,
    pouch: [
      -0.212,
      -0.375,
      -0.087
    ],
    mainRoll: -0.295,
    offRoll: 0.698,
    magRoll: -0.9,
    boltRoll: 0.5,
    loadRoll: 0.2,
    offShift: [
      -0.005,
      0.063,
      0.035
    ],
    offTilt: 0.55,
    shoulderR: [
      -0.05,
      0.08,
      0.047
    ],
    shoulderL: [
      0,
      0.07,
      -0.01
    ],
    adsShoulderR: [
      -0.033,
      0.09,
      -0.08
    ],
    adsShoulderL: [
      -0.02,
      0.093,
      0.09
    ],
    adsMainRoll: 0.4,
    adsOffRoll: 0.75
  },
  rifle_ak: {
    hip: [
      0.12,
      -0.155,
      -0.25
    ],
    converge: 12,
    relief: 0.2,
    adsDrop: 0.02,
    sprint: {
      at: [
        0.08,
        -0.26,
        -0.22
      ],
      turn: [
        -0.4,
        0.5,
        -0.25
      ]
    },
    wall: {
      at: [
        -0.025,
        -0.215,
        -0.125
      ],
      turn: [
        0.775,
        0.25,
        0.525
      ]
    },
    reload: {
      at: [
        0.05,
        -0.17,
        -0.25
      ],
      turn: [
        0.5,
        0.3,
        -0.2
      ]
    },
    lowered: {
      at: [
        0.12,
        -0.48,
        -0.18
      ],
      turn: [
        -0.45,
        0.3,
        0
      ]
    },
    inspectA: {
      at: [
        0.2,
        -0.195,
        -0.195
      ],
      turn: [
        0.225,
        0.275,
        0.575
      ]
    },
    inspectB: {
      at: [
        0.18,
        -0.21,
        -0.195
      ],
      turn: [
        0.375,
        -0.15,
        0.175
      ]
    },
    bash: {
      at: [
        0.165,
        -0.19,
        -0.28
      ],
      turn: [
        -0.075,
        0.1,
        0.35
      ]
    },
    crouch: -0.02,
    pouch: [
      -0.195,
      -0.575,
      -0.12
    ],
    mainRoll: 0.447,
    offRoll: 1.448,
    magRoll: -1.2,
    boltRoll: 0.3,
    loadRoll: 0.45,
    offShift: [
      0.015,
      0.045,
      0.045
    ],
    offTilt: 0.375,
    shoulderR: [
      -0.08,
      0.08,
      0.05
    ],
    shoulderL: [
      -0.047,
      0.067,
      0.043
    ],
    adsShoulderR: [
      -0.05,
      0.06,
      -0.07
    ],
    adsShoulderL: [
      -0.06,
      0.1,
      0.02
    ],
    adsMainRoll: 0.45,
    adsOffRoll: 0.15
  }
};
