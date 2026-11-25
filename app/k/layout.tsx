/** Customer pages always show in light colours, whatever the staff night-mode setting on this device. */
export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  return <div className="lightzone">{children}</div>;
}
