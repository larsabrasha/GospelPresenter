// The icons of the current app (Components/Symbols and inline SVGs there), Heroicons.
// Each takes a class for its size and colour; they are decoration, hidden from screen readers.
import type { PresentationItem } from '@gp/core';
import type { ReactNode } from 'react';

interface IconProps {
  className?: string;
}

/** An outline icon the current app draws in more than one weight. */
interface StrokeIconProps extends IconProps {
  strokeWidth?: number;
}

function Solid({ className, viewBox = '0 0 24 24', children }: IconProps & { viewBox?: string; children: ReactNode }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={viewBox} fill="currentColor" className={className} aria-hidden="true">
      {children}
    </svg>
  );
}

function Outline({ className, strokeWidth = 1.5, children }: IconProps & { strokeWidth?: number; children: ReactNode }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={strokeWidth} stroke="currentColor" className={className} aria-hidden="true">
      {children}
    </svg>
  );
}

export function LogoIcon({ className }: IconProps) {
  return (
    <Solid className={className} viewBox="0 0 1024 1024">
      <g transform="matrix(42.6667,0,0,42.6667,0,0)">
        <path d="M4.5,5.653C4.5,4.226 6.029,3.323 7.279,4.01L18.819,10.357C20.114,11.069 20.114,12.93 18.819,13.643L10.898,18C10.883,18.008 10.852,17.994 10.852,17.977L10.852,14.109C10.852,14.087 10.876,14.063 10.898,14.063L12.703,14.063C12.725,14.062 12.749,14.038 12.75,14.016L12.75,12.867C12.749,12.845 12.725,12.821 12.703,12.82L10.898,12.82C10.876,12.82 10.852,12.796 10.852,12.773L10.852,10.969C10.851,10.947 10.827,10.923 10.805,10.922L9.656,10.922C9.634,10.923 9.61,10.947 9.609,10.969L9.609,12.773C9.609,12.796 9.585,12.82 9.563,12.82L7.758,12.82C7.736,12.821 7.712,12.845 7.711,12.867L7.711,14.016C7.712,14.038 7.736,14.062 7.758,14.063L9.562,14.062C9.585,14.063 9.609,14.087 9.609,14.109L9.609,18.656C9.609,18.687 9.589,18.719 9.563,18.735L7.28,19.99C6.03,20.677 4.501,19.773 4.501,18.347L4.501,5.653L4.5,5.653Z" />
      </g>
    </Solid>
  );
}

/** Google's G, in its four colours (Components/SignIn.razor). */
export function GoogleIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </Outline>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <Outline className={className} strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </Outline>
  );
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <Outline className={className} strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </Outline>
  );
}

export function MenuIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </Outline>
  );
}

/** Two lines: an arrangement chip's drag handle (SongArrangementEditor.razor). */
export function GripIcon({ className }: IconProps) {
  return (
    <Outline className={className} strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9h16.5m-16.5 6.75h16.5" />
    </Outline>
  );
}

export function TrashIcon({ className, strokeWidth = 2 }: StrokeIconProps) {
  return (
    <Outline className={className} strokeWidth={strokeWidth}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
      />
    </Outline>
  );
}

export function CogIcon({ className }: IconProps) {
  return (
    <Solid className={className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a6.932 6.932 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.542-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28Z M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
      />
    </Solid>
  );
}

export function UserIcon({ className }: IconProps) {
  return (
    <Solid className={className} viewBox="0 0 20 20">
      <path d="M10 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.465 14.493a1.23 1.23 0 0 0 .41 1.412A9.957 9.957 0 0 0 10 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 0 0-13.074.003Z" />
    </Solid>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <Solid className={className} viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.993 6.993 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
      />
    </Solid>
  );
}

export function KeyIcon({ className }: IconProps) {
  return (
    <Solid className={className} viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8 7a5 5 0 1 1 3.61 4.804l-1.903 1.903A1 1 0 0 1 9 14H8v1a1 1 0 0 1-1 1H6v1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-2a1 1 0 0 1 .293-.707L8.196 8.39A5.002 5.002 0 0 1 8 7Zm5-3a.75.75 0 0 0 0 1.5A1.5 1.5 0 0 1 14.5 7 .75.75 0 0 0 16 7a3 3 0 0 0-3-3Z"
      />
    </Solid>
  );
}

export function SignOutIcon({ className }: IconProps) {
  return (
    <Solid className={className} viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M3 4.25A2.25 2.25 0 0 1 5.25 2h5.5A2.25 2.25 0 0 1 13 4.25v2a.75.75 0 0 1-1.5 0v-2a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 0 0 .75-.75v-2a.75.75 0 0 1 1.5 0v2A2.25 2.25 0 0 1 10.75 18h-5.5A2.25 2.25 0 0 1 3 15.75V4.25Z"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M6 10a.75.75 0 0 1 .75-.75h9.546l-1.048-.943a.75.75 0 1 1 1.004-1.114l2.5 2.25a.75.75 0 0 1 0 1.114l-2.5 2.25a.75.75 0 1 1-1.004-1.114l1.048-.943H6.75A.75.75 0 0 1 6 10Z"
      />
    </Solid>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <Solid className={className} viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
      />
    </Solid>
  );
}

/** A bold tick, for a success circle (PairingCodeDialog.razor). */
export function TickIcon({ className, strokeWidth = 3 }: StrokeIconProps) {
  return (
    <Outline className={className} strokeWidth={strokeWidth}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </Outline>
  );
}

export function CheckCircleIcon({ className }: IconProps) {
  return (
    <Solid className={className} viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z"
      />
    </Solid>
  );
}

export function WarningIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
      />
    </Outline>
  );
}

export function CloudCheckIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m9 13.5 2 2 4-4" />
    </Outline>
  );
}

export function CloudOffIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m3 3 18 18M6.75 7.547A8.25 8.25 0 0 0 4.5 18.75h11.69m3.148-1.42a4.5 4.5 0 0 0-2.09-8.28 6.75 6.75 0 0 0-9.815-4.588" />
    </Outline>
  );
}

export function DocumentIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
      />
    </Outline>
  );
}

export function SpinnerIcon({ className }: IconProps) {
  return (
    <svg className={`animate-spin ${className ?? ''}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// The theme choices (Pages/Settings.razor).

export function ComputerIcon({ className }: IconProps) {
  return (
    <Solid className={className} viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M2 4.25A2.25 2.25 0 0 1 4.25 2h11.5A2.25 2.25 0 0 1 18 4.25v8.5A2.25 2.25 0 0 1 15.75 15h-3.105a3.501 3.501 0 0 0 1.1 1.677A.75.75 0 0 1 13.26 18H6.74a.75.75 0 0 1-.484-1.323A3.501 3.501 0 0 0 7.355 15H4.25A2.25 2.25 0 0 1 2 12.75v-8.5Zm1.5 0a.75.75 0 0 1 .75-.75h11.5a.75.75 0 0 1 .75.75v7.5a.75.75 0 0 1-.75.75H4.25a.75.75 0 0 1-.75-.75v-7.5Z"
      />
    </Solid>
  );
}

export function SunIcon({ className }: IconProps) {
  return (
    <Solid className={className} viewBox="0 0 20 20">
      <path d="M10 2a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 2ZM10 15a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 15ZM10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM15.657 5.404a.75.75 0 1 0-1.06-1.06l-1.061 1.06a.75.75 0 0 0 1.06 1.061l1.061-1.06ZM6.464 14.596a.75.75 0 1 0-1.06-1.06l-1.06 1.06a.75.75 0 0 0 1.06 1.06l1.06-1.06ZM18 10a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 18 10ZM5 10a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 5 10ZM14.596 15.657a.75.75 0 0 0 1.06-1.06l-1.06-1.061a.75.75 0 1 0-1.06 1.06l1.06 1.061ZM5.404 6.464a.75.75 0 0 0 1.06-1.06l-1.06-1.06a.75.75 0 1 0-1.06 1.06l1.06 1.06Z" />
    </Solid>
  );
}

export function MoonIcon({ className }: IconProps) {
  return (
    <Solid className={className} viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M7.455 2.004a.75.75 0 0 1 .26.77 7 7 0 0 0 9.958 7.967.75.75 0 0 1 1.067.853A8.5 8.5 0 1 1 6.647 1.921a.75.75 0 0 1 .808.083Z"
      />
    </Solid>
  );
}

// The admin menu (Layout/AdminLayout.razor).

export function MusicalNoteIcon({ className }: IconProps) {
  return (
    <Solid className={className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M19.952 1.651a.75.75 0 0 1 .298.599V16.303a3 3 0 0 1-2.176 2.884l-1.32.377a2.553 2.553 0 1 1-1.403-4.909l2.311-.66a1.5 1.5 0 0 0 1.088-1.442V6.994l-9 2.572v9.737a3 3 0 0 1-2.176 2.884l-1.32.377a2.553 2.553 0 1 1-1.402-4.909l2.31-.66a1.5 1.5 0 0 0 1.088-1.442V5.25a.75.75 0 0 1 .544-.721l10.5-3a.75.75 0 0 1 .658.122Z"
      />
    </Solid>
  );
}

export function BookOpenIcon({ className }: IconProps) {
  return (
    <Solid className={className}>
      <path d="M11.25 4.533A9.707 9.707 0 0 0 6 3a9.735 9.735 0 0 0-3.25.555.75.75 0 0 0-.5.707v14.25a.75.75 0 0 0 1 .707A8.237 8.237 0 0 1 6 18.75c1.995 0 3.823.707 5.25 1.886V4.533ZM12.75 20.636A8.214 8.214 0 0 1 18 18.75c.966 0 1.89.166 2.75.47a.75.75 0 0 0 1-.708V4.262a.75.75 0 0 0-.5-.707A9.735 9.735 0 0 0 18 3a9.707 9.707 0 0 0-5.25 1.533v16.103Z" />
    </Solid>
  );
}

export function PhotoIcon({ className }: IconProps) {
  return (
    <Solid className={className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M1.5 6a2.25 2.25 0 0 1 2.25-2.25h16.5A2.25 2.25 0 0 1 22.5 6v12a2.25 2.25 0 0 1-2.25 2.25H3.75A2.25 2.25 0 0 1 1.5 18V6ZM3 16.06V18c0 .414.336.75.75.75h16.5A.75.75 0 0 0 21 18v-1.94l-2.69-2.689a1.5 1.5 0 0 0-2.12 0l-.88.879.97.97a.75.75 0 1 1-1.06 1.06l-5.16-5.159a1.5 1.5 0 0 0-2.12 0L3 16.061Zm10.125-7.81a1.125 1.125 0 1 1 2.25 0 1.125 1.125 0 0 1-2.25 0Z"
      />
    </Solid>
  );
}

export function SpeakerWaveIcon({ className }: IconProps) {
  return (
    <Solid className={className}>
      <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 0 0 1.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06ZM18.584 5.106a.75.75 0 0 1 1.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 0 1-1.06-1.06 8.25 8.25 0 0 0 0-11.668.75.75 0 0 1 0-1.06Z" />
      <path d="M15.932 7.757a.75.75 0 0 1 1.061 0 6 6 0 0 1 0 8.486.75.75 0 0 1-1.06-1.061 4.5 4.5 0 0 0 0-6.364.75.75 0 0 1 0-1.06Z" />
    </Solid>
  );
}

export function SquaresOverlapIcon({ className }: IconProps) {
  return (
    <Solid className={className} viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M2 4.25A2.25 2.25 0 0 1 4.25 2h6.5A2.25 2.25 0 0 1 13 4.25v1.5h2.75A2.25 2.25 0 0 1 18 8v7.75A2.25 2.25 0 0 1 15.75 18H9.25A2.25 2.25 0 0 1 7 15.75v-1.5H4.25A2.25 2.25 0 0 1 2 12V4.25Zm5 9.25v2.25c0 .414.336.75.75.75h6.5a.75.75 0 0 0 .75-.75V8a.75.75 0 0 0-.75-.75H13v4.75A2.25 2.25 0 0 1 10.75 14.25h-3.75Z"
      />
    </Solid>
  );
}

export function DesktopIcon({ className }: IconProps) {
  return (
    <Solid className={className} viewBox="0 0 20 20">
      <path d="M3 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Z" />
      <path d="M8 13h4v2H8v-2Z" />
      <path d="M6 16a1 1 0 0 0 0 2h8a1 1 0 1 0 0-2H6Z" />
    </Solid>
  );
}

export function BarsIcon({ className }: IconProps) {
  return (
    <Solid className={className} viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M1 2.75A.75.75 0 0 1 1.75 2h16.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 2.75Zm0 5A.75.75 0 0 1 1.75 7h16.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 7.75ZM1.75 12a.75.75 0 0 0 0 1.5h10.5a.75.75 0 0 0 0-1.5H1.75Zm0 5a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-6.5Z"
      />
    </Solid>
  );
}

export function UsersIcon({ className }: IconProps) {
  return (
    <Solid className={className} viewBox="0 0 20 20">
      <path d="M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM14.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM1.615 16.428a1.224 1.224 0 0 1-.569-1.175 6.002 6.002 0 0 1 11.908 0c.058.467-.172.92-.57 1.174A9.953 9.953 0 0 1 7 18a9.953 9.953 0 0 1-5.385-1.572ZM14.5 16h-.106c.07-.297.088-.611.048-.933a7.47 7.47 0 0 0-1.588-3.755 4.502 4.502 0 0 1 5.874 2.636.818.818 0 0 1-.36.98A7.465 7.465 0 0 1 14.5 16Z" />
    </Solid>
  );
}

export function DevicesIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0V12a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 12V5.25"
      />
    </Outline>
  );
}

// The presentation, live and stage view (Pages/Presentation.razor, LivePanel.razor, StageView.razor).

export function PlayIcon({ className }: IconProps) {
  return (
    <Solid className={className}>
      <path fillRule="evenodd" clipRule="evenodd" d="M4.5 5.653c0-1.427 1.529-2.33 2.779-1.643l11.54 6.347c1.295.712 1.295 2.573 0 3.286L7.28 19.99c-1.25.687-2.779-.217-2.779-1.643V5.653Z" />
    </Solid>
  );
}

export function PauseIcon({ className }: IconProps) {
  return (
    <Solid className={className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M6.75 5.25a.75.75 0 0 1 .75-.75H9a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75H7.5a.75.75 0 0 1-.75-.75V5.25Zm7.5 0A.75.75 0 0 1 15 4.5h1.5a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75H15a.75.75 0 0 1-.75-.75V5.25Z"
      />
    </Solid>
  );
}

export function StopIcon({ className }: IconProps) {
  return (
    <Solid className={className}>
      <path fillRule="evenodd" clipRule="evenodd" d="M4.5 7.5a3 3 0 0 1 3-3h9a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3v-9Z" />
    </Solid>
  );
}

/** Tona ut: the speaker with its wave faded (Components/Presentations/AudioPlayer.razor). */
export function FadeOutIcon({ className }: IconProps) {
  return (
    <Solid className={className}>
      <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 0 0 1.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06Z" />
      <path d="M16.5 12a4.5 4.5 0 0 0-.93-2.737.75.75 0 1 1 1.18-.926A6 6 0 0 1 18 12a6 6 0 0 1-1.25 3.663.75.75 0 1 1-1.18-.926A4.5 4.5 0 0 0 16.5 12Z" opacity="0.4" />
    </Solid>
  );
}

export function SpeakerOutlineIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z"
      />
    </Outline>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <Outline className={className} strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </Outline>
  );
}

export function ChevronLeftIcon({ className }: IconProps) {
  return (
    <Outline className={className} strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
    </Outline>
  );
}

export function ChevronUpIcon({ className }: IconProps) {
  return (
    <Outline className={className} strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
    </Outline>
  );
}

/** Scenläge (LivePanel.razor). */
export function ArrowsPointingOutIcon({ className }: IconProps) {
  return (
    <Outline className={className} strokeWidth={1.75}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
      />
    </Outline>
  );
}

/** Fjärrstyrning (LivePanel.razor). */
export function RemoteIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0H3"
      />
    </Outline>
  );
}

/** The empty presentation's picture: three slides and a plus (SlideGrid.razor). */
export function EmptySlidesPicture({ className }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 200 160" className={className} aria-hidden="true">
      <rect x="50" y="10" width="120" height="80" rx="8" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.5" />
      <rect x="35" y="25" width="120" height="80" rx="8" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.7" />
      <rect x="20" y="40" width="120" height="80" rx="8" stroke="currentColor" strokeWidth="2" className="fill-neutral-100 dark:fill-neutral-800" />
      <line x1="40" y1="65" x2="120" y2="65" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.4" />
      <line x1="40" y1="78" x2="100" y2="78" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.3" />
      <line x1="40" y1="91" x2="110" y2="91" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.2" />
      <circle cx="160" cy="130" r="20" stroke="currentColor" strokeWidth="2" className="fill-neutral-100 dark:fill-neutral-800" />
      <line x1="160" y1="120" x2="160" y2="140" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="150" y1="130" x2="170" y2="130" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function PencilIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125"
      />
    </Outline>
  );
}

/** "Ingen sång vald" (AddItem/Song/SongTab.razor): an outlined note. */
export function MusicalNoteOutlineIcon({ className, strokeWidth = 1 }: StrokeIconProps) {
  return (
    <Outline className={className} strokeWidth={strokeWidth}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m9 9 10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163Zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 0 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 9 15.553Z"
      />
    </Outline>
  );
}

/** The icon of an item's kind, as in the running order (Components/Presentations/Sidebar.razor). */
export function ItemIcon({ type, className }: { type: PresentationItem['type']; className?: string }) {
  const Icon = { song: MusicalNoteIcon, bible: BookOpenIcon, image: PhotoIcon, audio: SpeakerWaveIcon }[type];
  return <Icon className={className} />;
}

// The admin pages (Pages/Admin/*.razor, Trash.razor, Components/DropZone.razor).

/** Import, and the drop zone's hint: a tray with an arrow into it. */
export function ArrowDownTrayIcon({ className, strokeWidth = 2 }: StrokeIconProps) {
  return (
    <Outline className={className} strokeWidth={strokeWidth}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </Outline>
  );
}

/** "⋯", a menu of one thing (Images.razor, Audios.razor). */
export function EllipsisIcon({ className }: IconProps) {
  return (
    <Solid className={className} viewBox="0 0 20 20">
      <path d="M3 10a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0ZM8.5 10a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0ZM15.5 8.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" />
    </Solid>
  );
}

export function LinkIcon({ className }: IconProps) {
  return (
    <Solid className={className} viewBox="0 0 20 20">
      <path d="M12.232 4.232a2.5 2.5 0 0 1 3.536 3.536l-1.225 1.224a.75.75 0 0 0 1.061 1.06l1.224-1.224a4 4 0 0 0-5.656-5.656l-3 3a4 4 0 0 0 .225 5.865.75.75 0 0 0 .977-1.138 2.5 2.5 0 0 1-.142-3.667l3-3Z" />
      <path d="M11.603 7.963a.75.75 0 0 0-.977 1.138 2.5 2.5 0 0 1 .142 3.667l-3 3a2.5 2.5 0 0 1-3.536-3.536l1.225-1.224a.75.75 0 0 0-1.061-1.06l-1.224 1.224a4 4 0 1 0 5.656 5.656l3-3a4 4 0 0 0-.225-5.865Z" />
    </Solid>
  );
}

export function QrCodeIcon({ className }: IconProps) {
  return (
    <Solid className={className} viewBox="0 0 20 20">
      <path d="M3 3h5v5H3V3Zm1.5 1.5v2h2v-2h-2ZM12 3h5v5h-5V3Zm1.5 1.5v2h2v-2h-2ZM3 12h5v5H3v-5Zm1.5 1.5v2h2v-2h-2ZM12 12h1.5v1.5H12V12Zm3.5 0H17v1.5h-1.5V12ZM12 15.5h1.5V17H12v-1.5Zm3.5 0H17V17h-1.5v-1.5ZM9.5 3H11v1.5H9.5V3Zm0 3H11v1.5H9.5V6Zm0 3H11v1.5H9.5V9ZM3 9.5h1.5V11H3V9.5Zm3.5 0H8V11H6.5V9.5Zm6.5 0h1.5V11H13V9.5Zm3 0H17V11h-1V9.5Z" />
    </Solid>
  );
}

/** The QR code in outline, on the live panel's "Visa info om fjärrstyrning" (LivePanel.razor). */
export function QrCodeOutlineIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 3.75 9.375v-4.5ZM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 0 1-1.125-1.125v-4.5ZM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 13.5 9.375v-4.5Z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.75 6.75h.75v.75h-.75v-.75ZM6.75 16.5h.75v.75h-.75v-.75ZM16.5 6.75h.75v.75h-.75v-.75ZM13.5 13.5h.75v.75h-.75v-.75ZM13.5 19.5h.75v.75h-.75v-.75ZM19.5 13.5h.75v.75h-.75v-.75ZM19.5 19.5h.75v.75h-.75v-.75ZM16.5 16.5h.75v.75h-.75v-.75Z"
      />
    </Outline>
  );
}

/** Copy to the clipboard: two sheets. */
export function CopyIcon({ className }: IconProps) {
  return (
    <Solid className={className} viewBox="0 0 20 20">
      <path d="M7 3.5A1.5 1.5 0 0 1 8.5 2h3.879a1.5 1.5 0 0 1 1.06.44l3.122 3.12A1.5 1.5 0 0 1 17 6.622V12.5a1.5 1.5 0 0 1-1.5 1.5h-1v-3.379a3 3 0 0 0-.879-2.121L10.5 5.379A3 3 0 0 0 8.379 4.5H7v-1Z" />
      <path d="M4.5 6A1.5 1.5 0 0 0 3 7.5v9A1.5 1.5 0 0 0 4.5 18h7a1.5 1.5 0 0 0 1.5-1.5v-5.879a1.5 1.5 0 0 0-.44-1.06L9.44 6.439A1.5 1.5 0 0 0 8.378 6H4.5Z" />
    </Solid>
  );
}

/** A screen, green while it is online; struck through while it is not (Displays.razor). */
export function ScreenIcon({ className, offline }: IconProps & { offline?: boolean }) {
  return (
    <Solid className={className} viewBox="0 0 20 20">
      <path d="M3 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Z" />
      <path d="M8 13h4v2H8v-2Z" />
      <path d="M6 16a1 1 0 0 0 0 2h8a1 1 0 1 0 0-2H6Z" />
      {offline && (
        <>
          <line x1="3" y1="2" x2="17" y2="18" stroke="white" strokeWidth="3.5" strokeLinecap="round" />
          <line x1="3" y1="2" x2="17" y2="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
    </Solid>
  );
}

export function BookOpenOutlineIcon({ className, strokeWidth = 1 }: StrokeIconProps) {
  return (
    <Outline className={className} strokeWidth={strokeWidth}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"
      />
    </Outline>
  );
}

/** A picture: the empty image library, and a picture in the trash. */
export function PhotoOutlineIcon({ className, strokeWidth = 1 }: StrokeIconProps) {
  return (
    <Outline className={className} strokeWidth={strokeWidth}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
      />
    </Outline>
  );
}

/** A presentation in the trash: a folded map (Trash.razor). */
export function MapIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z"
      />
    </Outline>
  );
}

// The large grey pictures of the admin pages' empty lists.

const PICTURE_FILL = 'fill-neutral-100 dark:fill-neutral-800';

/** A circle with a plus, at the lower right of several pictures. */
function PlusBadge() {
  return (
    <>
      <circle cx="155" cy="120" r="16" stroke="currentColor" strokeWidth="2" className={PICTURE_FILL} />
      <line x1="155" y1="112" x2="155" y2="128" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="147" y1="120" x2="163" y2="120" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </>
  );
}

function Picture({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 200 160" className={className} aria-hidden="true">
      {children}
    </svg>
  );
}

/** No overlays: a slide with a dashed box over it (Overlays.razor). */
export function OverlaysPicture({ className }: IconProps) {
  return (
    <Picture className={className}>
      <rect x="30" y="20" width="140" height="90" rx="8" stroke="currentColor" strokeWidth="2" className={PICTURE_FILL} />
      <line x1="50" y1="50" x2="150" y2="50" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.3" />
      <line x1="50" y1="65" x2="130" y2="65" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.2" />
      <rect x="55" y="45" width="100" height="60" rx="6" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" fill="none" opacity="0.7" />
      <line x1="75" y1="70" x2="135" y2="70" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.5" />
      <line x1="85" y1="82" x2="125" y2="82" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.4" />
    </Picture>
  );
}

/** No screens: a monitor and a plus (Displays.razor). */
export function ScreensPicture({ className }: IconProps) {
  return (
    <Picture className={className}>
      <rect x="30" y="20" width="140" height="90" rx="8" stroke="currentColor" strokeWidth="2" className={PICTURE_FILL} />
      <rect x="45" y="35" width="110" height="60" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.4" />
      <rect x="80" y="110" width="40" height="8" rx="2" stroke="currentColor" strokeWidth="2" className={PICTURE_FILL} />
      <rect x="60" y="118" width="80" height="6" rx="3" stroke="currentColor" strokeWidth="2" className={PICTURE_FILL} />
      <PlusBadge />
    </Picture>
  );
}

/** No public outputs: a QR code and a phone (Displays.razor). */
export function PublicOutputsPicture({ className }: IconProps) {
  return (
    <Picture className={className}>
      <rect x="55" y="15" width="90" height="90" rx="8" stroke="currentColor" strokeWidth="2" className={PICTURE_FILL} />
      <rect x="68" y="28" width="20" height="20" rx="3" stroke="currentColor" strokeWidth="2" fill="none" />
      <rect x="112" y="28" width="20" height="20" rx="3" stroke="currentColor" strokeWidth="2" fill="none" />
      <rect x="68" y="72" width="20" height="20" rx="3" stroke="currentColor" strokeWidth="2" fill="none" />
      <rect x="98" y="58" width="8" height="8" rx="1" fill="currentColor" opacity="0.5" />
      <rect x="112" y="72" width="8" height="8" rx="1" fill="currentColor" opacity="0.5" />
      <rect x="124" y="84" width="8" height="8" rx="1" fill="currentColor" opacity="0.5" />
      <rect x="82" y="115" width="36" height="34" rx="5" stroke="currentColor" strokeWidth="2" className={PICTURE_FILL} />
      <line x1="94" y1="143" x2="106" y2="143" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </Picture>
  );
}

/** No users: a person and a plus (Users.razor). */
export function UsersPicture({ className }: IconProps) {
  return (
    <Picture className={className}>
      <circle cx="100" cy="50" r="24" stroke="currentColor" strokeWidth="2" className={PICTURE_FILL} />
      <circle cx="100" cy="50" r="10" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.4" />
      <path d="M60 130c0-22.091 17.909-40 40-40s40 17.909 40 40" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
      <PlusBadge />
    </Picture>
  );
}

/** No devices: a laptop (Devices.razor). */
export function DevicesPicture({ className }: IconProps) {
  return (
    <Picture className={className}>
      <rect x="42" y="34" width="116" height="76" rx="6" stroke="currentColor" strokeWidth="2" className={PICTURE_FILL} />
      <path d="M42 96h116" stroke="currentColor" strokeWidth="2" />
      <path d="M76 126h48M88 110l-4 16M112 110l4 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="100" cy="103" r="2.5" fill="currentColor" opacity="0.5" />
    </Picture>
  );
}

/** The ⋯ by a presentation's name (Presentations/Sidebar.razor): three outlined dots. */
export function EllipsisOutlineIcon({ className }: IconProps) {
  return (
    <Outline className={className}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM12.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM18.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z"
      />
    </Outline>
  );
}
