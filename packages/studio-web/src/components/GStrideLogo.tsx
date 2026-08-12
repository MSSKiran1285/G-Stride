import React from 'react';

interface GStrideLogoProps {
  size?: number;
  className?: string;
}

export const GStrideLogo: React.FC<GStrideLogoProps> = ({ size = 28, className = '' }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`g-stride-logo-icon ${className}`}
      aria-hidden="true"
    >
      {/* Outer 3D Cube Hexagon Outline */}
      <path
        d="M50 8 L88 30 L88 74 L50 96 L12 74 L12 30 Z"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Top Diamond Face */}
      <path
        d="M50 8 L88 30 L50 52 L12 30 Z"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      {/* Center Cube Joint */}
      <path
        d="M50 52 L50 96"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
      {/* G Isometric Cutout Inner Lines */}
      <path
        d="M50 52 L88 30"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M31 41 L69 63 L69 85"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M50 52 L31 41 L31 63 L50 74 L69 63"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
};
