import Image from "next/image";

export default function Logo() {
  return (
    <div className="wordmark">
      <Image src="/logo.svg" alt="" width={28} height={28} unoptimized />
      <span>vector1090</span>
    </div>
  );
}
